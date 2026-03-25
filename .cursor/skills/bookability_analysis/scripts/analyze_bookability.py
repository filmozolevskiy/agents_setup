#!/usr/bin/env python3
"""
Utility script to analyze bookability failures from MongoDB optimizer_logs.
Used by the bookability-analysis skill to quickly identify price changes,
availability loss, or validation errors for a given transaction_id.
"""

import sys
import os
import json
from pymongo import MongoClient
from bson import json_util

def get_client():
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        print("Error: MONGODB_URI environment variable is not set.", file=sys.stderr)
        sys.exit(1)
    return MongoClient(uri, serverSelectionTimeoutMS=10_000)

def analyze_transaction(transaction_id):
    client = get_client()
    db_name = os.environ.get("MONGODB_DATABASE", "ota")
    db = client[db_name]
    coll = db["optimizer_logs"]

    # Fetch logs for the transaction_id, sorted by date_added
    logs = list(coll.find({"transaction_id": transaction_id}).sort("date_added", 1))

    if not logs:
        print(f"No logs found for transaction_id: {transaction_id}")
        return

    print(f"Analyzing {len(logs)} log entries for transaction: {transaction_id}\n")

    failures = []
    price_changes = []
    
    for log in logs:
        context = log.get("context", "Unknown")
        level = log.get("level", "info")
        date = log.get("date_added", "N/A")
        
        # Check for explicit failure level or context
        if level == "error" or "failure" in str(log).lower():
            failures.append({
                "date": date,
                "context": context,
                "message": log.get("meta", {}).get("error_message") or log.get("message") or "Detailed message not found"
            })

        # Check for price changes in the fares array
        fares = log.get("fares", [])
        if isinstance(fares, list):
            for fare in fares:
                status = fare.get("status")
                if status == "price_changed" or status == "unavailable":
                    price_changes.append({
                        "date": date,
                        "context": context,
                        "status": status,
                        "details": fare.get("meta", {})
                    })

    if failures:
        print("--- Potential Failures Found ---")
        for f in failures:
            print(f"[{f['date']}] {f['context']}: {f['message']}")
        print()

    if price_changes:
        print("--- Price or Availability Changes ---")
        for pc in price_changes:
            print(f"[{pc['date']}] {pc['context']} - {pc['status'].upper()}")
            if pc['details']:
                print(f"  Details: {json.dumps(pc['details'], default=str)}")
        print()

    if not failures and not price_changes:
        print("No obvious failures or price changes detected in the logs.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/analyze_bookability.py <transaction_id>")
        sys.exit(1)

    transaction_id = sys.argv[1]
    
    # Ensure environment variables are loaded
    # Usually handled by the shell, but useful for standalone testing
    if "MONGODB_URI" not in os.environ:
        print("Warning: MONGODB_URI not found in environment. Make sure to source .env")
        
    analyze_transaction(transaction_id)
