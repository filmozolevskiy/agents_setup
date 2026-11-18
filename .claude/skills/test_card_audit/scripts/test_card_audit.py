#!/usr/bin/env python3
"""List underfunded and unvoided items on our test cards.

Both are operations on a test-card booking that are not fully reversed: a
capture with money left after its refunds / voids, an auth hold that was never
captured or released, or an operation still `pending`.

- underfunded item: processor = 'payhub' (we charged the test card and did not
  give it all back).
- unvoided item: any other processor -- 'agency' (we paid the supplier for the
  ticket), 'gordian' (seats), 'chase', insurance, ... (the supplier-side charge
  was never voided or refunded).

Usage:
    set -a && source .env && set +a
    python3 .claude/skills/test_card_audit/scripts/test_card_audit.py
    python3 .claude/skills/test_card_audit/scripts/test_card_audit.py --since 2026-10-01
    python3 .claude/skills/test_card_audit/scripts/test_card_audit.py --booking-id 313399591
    python3 .claude/skills/test_card_audit/scripts/test_card_audit.py --only unvoided
    python3 .claude/skills/test_card_audit/scripts/test_card_audit.py --json

Test cards come from env vars (never printed):
    CC_NUMBER          one card (required unless TEST_CC_NUMBERS is set)
    TEST_CC_NUMBERS    optional, comma-separated extra cards

Cards are matched in ota.booking_billing_info by cc_first_6 + cc_last_4.
Output shows only the masked card (first 6 + last 4).
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from decimal import Decimal

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "db_access", "scripts"),
)
from mysql_query import get_connection  # noqa: E402

CAPTURE_TYPES = ("auth_capture", "capture")
REVERSAL_TYPES = ("refund", "void", "auth_reversal")
ZERO = Decimal("0.00")


def load_cards():
    raw = []
    if os.environ.get("CC_NUMBER"):
        raw.append(os.environ["CC_NUMBER"])
    raw += [c for c in os.environ.get("TEST_CC_NUMBERS", "").split(",") if c.strip()]
    cards = []
    for c in raw:
        digits = "".join(ch for ch in c if ch.isdigit())
        if len(digits) < 12:
            sys.exit("Error: a test card env value is not a card number.")
        key = (digits[:6], digits[-4:])
        if key not in cards:
            cards.append(key)
    if not cards:
        sys.exit("Error: set CC_NUMBER (or TEST_CC_NUMBERS) in .env.")
    return cards


def mask(f6, l4):
    return f"{f6}******{l4}"


def fetch(conn, cards, since, booking_id):
    card_sql = " OR ".join(["(cc_first_6=%s AND cc_last_4=%s)"] * len(cards))
    params = [v for pair in cards for v in pair]
    extra = ""
    if since:
        extra += " AND date_added >= %s"
        params.append(since)
    if booking_id:
        extra += " AND booking_id = %s"
        params.append(booking_id)
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT booking_id, cc_first_6, cc_last_4, MIN(date_added) AS first_seen "
            f"FROM booking_billing_info WHERE ({card_sql}){extra} "
            f"GROUP BY booking_id, cc_first_6, cc_last_4",
            params,
        )
        billing = cur.fetchall()
        if not billing:
            return billing, [], {}
        ids = sorted({r["booking_id"] for r in billing})
        ph = ",".join(["%s"] * len(ids))
        cur.execute(
            f"SELECT id, booking_id, processor, type, status, amount, currency, "
            f"parent_transaction_id, transaction_date "
            f"FROM booking_statement_transactions "
            f"WHERE booking_id IN ({ph}) "
            f"ORDER BY booking_id, transaction_date, id",
            ids,
        )
        txs = cur.fetchall()
        cur.execute(
            f"SELECT id, status, is_test FROM bookings WHERE id IN ({ph})", ids
        )
        bookings = {r["id"]: r for r in cur.fetchall()}
    return billing, txs, bookings


def find_items(txs):
    """Return underfunded items, one per open capture / open auth / pending op."""
    by_id = {t["id"]: t for t in txs}
    children = defaultdict(list)
    for t in txs:
        if t["parent_transaction_id"]:
            children[t["parent_transaction_id"]].append(t)

    items = []
    for t in txs:
        if t["status"] == "pending":
            items.append((t, "pending_operation", t["amount"], "Operation still pending at Payhub"))
            continue
        if t["status"] != "success":
            continue
        kids = [k for k in children[t["id"]] if k["status"] == "success"]
        if t["type"] in CAPTURE_TYPES:
            reversed_amt = sum((k["amount"] for k in kids if k["type"] in REVERSAL_TYPES), ZERO)
            left = t["amount"] - reversed_amt
            if left > ZERO:
                note = "No refund or void" if reversed_amt == ZERO else f"Partly reversed ({reversed_amt})"
                items.append((t, "open_capture", left, note))
        elif t["type"] == "auth" and t["amount"] > ZERO:
            used = sum((k["amount"] for k in kids if k["type"] == "capture"), ZERO)
            released = sum((k["amount"] for k in kids if k["type"] in REVERSAL_TYPES), ZERO)
            left = t["amount"] - used - released
            if left > ZERO:
                items.append((t, "open_auth", left, "Hold not captured or released"))

    # Orphan reversals (no parent) reduce the booking's open captures; flag them so
    # the reader can check by hand instead of trusting the per-item number.
    orphans = [
        t for t in txs
        if t["status"] == "success" and t["type"] in REVERSAL_TYPES
        and (not t["parent_transaction_id"] or t["parent_transaction_id"] not in by_id)
    ]
    return items, orphans


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--since", help="Only bookings whose billing row is on/after this date (YYYY-MM-DD)")
    ap.add_argument("--booking-id", type=int, help="Check one booking")
    ap.add_argument("--only", choices=["underfunded", "unvoided"], help="Show one category only")
    ap.add_argument("--json", action="store_true", help="Print JSON instead of a table")
    args = ap.parse_args()

    cards = load_cards()
    conn = get_connection("ota")
    with conn:
        billing, txs, bookings = fetch(conn, cards, args.since, args.booking_id)

    card_of = {r["booking_id"]: mask(r["cc_first_6"], r["cc_last_4"]) for r in billing}
    txs_by_group = defaultdict(list)
    for t in txs:
        txs_by_group[(t["booking_id"], t["processor"] or "")].append(t)

    rows, warnings = [], []
    totals = {"underfunded": defaultdict(lambda: ZERO), "unvoided": defaultdict(lambda: ZERO)}
    for (bid, proc) in sorted(txs_by_group, key=lambda k: (-k[0], k[1] != "payhub", k[1])):
        category = "underfunded" if proc == "payhub" else "unvoided"
        if args.only and args.only != category:
            continue
        items, orphans = find_items(txs_by_group[(bid, proc)])
        b = bookings.get(bid, {})
        for o in orphans:
            warnings.append(f"booking {bid}: {proc} {o['type']} {o['amount']} {o['currency']} (tx {o['id']}) has no parent; check by hand")
        for t, kind, left, note in items:
            rows.append({
                "category": category,
                "processor": proc,
                "booking_id": bid,
                "booking_status": b.get("status"),
                "is_test": b.get("is_test"),
                "card": card_of.get(bid),
                "kind": kind,
                "tx_id": t["id"],
                "tx_type": t["type"],
                "tx_date": str(t["transaction_date"]),
                "charged": str(t["amount"]),
                "open_amount": str(left),
                "currency": t["currency"],
                "note": note,
                "respro": f"https://reservations.voyagesalacarte.ca/booking/index/{bid}",
            })
            totals[category][t["currency"]] += left

    summary = {
        "cards": [mask(*c) for c in cards],
        "bookings_on_cards": len(card_of),
        "bookings_with_items": len({r["booking_id"] for r in rows}),
        "items": len(rows),
        "open_totals": {
            cat: {k: str(v) for k, v in sorted(tot.items())} for cat, tot in totals.items()
            if not args.only or args.only == cat
        },
        "since": args.since,
        "warnings": warnings,
    }

    if args.json:
        print(json.dumps({"summary": summary, "items": rows}, indent=2))
        return

    print(f"Cards: {', '.join(summary['cards'])}")
    print(f"Bookings on cards: {summary['bookings_on_cards']} | with items: "
          f"{summary['bookings_with_items']} | items: {summary['items']}")
    for cat, tot in summary["open_totals"].items():
        n = sum(1 for r in rows if r["category"] == cat)
        print(f"Open {cat} ({n} items): " + (", ".join(f"{v} {k}" for k, v in tot.items()) or "none"))
    cols = ["category", "processor", "booking_id", "booking_status", "is_test", "kind", "tx_date",
            "open_amount", "currency", "note"]
    if rows:
        w = {c: max(len(c), *(len(str(r[c])) for r in rows)) for c in cols}
        print()
        print(" | ".join(c.ljust(w[c]) for c in cols))
        print("-+-".join("-" * w[c] for c in cols))
        for r in rows:
            print(" | ".join(str(r[c]).ljust(w[c]) for c in cols))
    for wmsg in warnings:
        print(f"WARNING: {wmsg}")


if __name__ == "__main__":
    main()
