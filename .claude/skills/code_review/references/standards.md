# Coding standards — mventures/genesis

Mined from `jpleveille-mv`'s PR review comments on PRs merged into
`develop`. Each Rule below is a recurring theme backed by ≥2 distinct PR
permalinks. The `code_review` skill consumes this file as its source of
truth; the review motion cites Rule IDs verbatim in findings.

See the rule shape and field rules in
[`../SKILL.md` § Rule shape](../SKILL.md). Field-by-field template per
rule:

```markdown
### R<NN>: <short imperative title>

**Rule:** <one sentence, imperative>

**Why:** <one sentence — the failure mode the rule prevents>

**Smell to detect:** <concrete pattern a reviewer or agent can grep / eyeball — file globs, code shapes, naming, structural cue>

**Skip if:** <optional bullet list — contextual cues that suppress or downgrade a smell match; cite the dev pushback permalink that justifies the guard>

**Evidence:**
- https://github.com/mventures/genesis/pull/<N>#discussion_r<id> — "<JP quote, trimmed>"
- https://github.com/mventures/genesis/pull/<N>#discussion_r<id> — "<JP quote, trimmed>"

**Severity:** blocker | nit

**last_evidence_at:** YYYY-MM-DD
```

---

### R01: Guard every nullable value; do not let `?->` or non-numeric input slip through

**Rule:** Treat every value that can be `null` as nullable at every hop — null-coalesce, default-initialize a typed property, or check `isset` — and never use `?->` as proof that a property was assigned.

**Why:** `?->` only short-circuits when the chain head is `null`; it does not test for "never initialized", and non-numeric inputs silently coerce to `0` and corrupt downstream index math.

**Smell to detect:** `?->` on a property that has no nullable type declaration and no default; a `(int)$x` / `intval($x)` that feeds `$x - 1` or an array offset; a payload field read without `?? <default>`; a typed property declared without `?` despite being assigned in only some code paths. Concentrates in `src/Supplier/**` response parsers and `include/Mv/Ota/**` payload builders.

**Evidence:**
- https://github.com/mventures/genesis/pull/52700#discussion_r3017888771 — "`?->` does not test for initialization. My recommendation is to declare `…::$office` as `protected ?AbstractNdcOneOffice $office = null;`"
- https://github.com/mventures/genesis/pull/53287#discussion_r3190660421 — "Whatever the error reported, if `$index` is non-numeric it converts to `0`… Then `$index - 1` is `-1` and that is most likely an undefined index"
- https://github.com/mventures/genesis/pull/52575#discussion_r3011655890 — "No need to test this condition really, just `$data = $marketingFareAlert?->getData() ?? [];` and the rest below will take care of it"
- https://github.com/mventures/genesis/pull/53877#discussion_r3373860193 — "Testing for `array` would be stricter as code below invokes `array_merge()`: `if (is_array($fares['inf'] ?? null)) {`"

**Severity:** nit

**last_evidence_at:** 2026-06-08

---

### R02: Name a method or constant after what it returns, not after the question it answers

**Rule:** Rename methods, constants, and guards so the name states the answer or the action — use positive predicates, prefix immutable setters with `with`, and avoid generic verbs like `match`, `Random`, or anonymous `guardX`.

**Why:** A vague or negated name forces every caller to re-read the body to learn the contract, and review comments otherwise repeat for every new supplier that copies the name.

**Smell to detect:** Method names that read like the question (`match()`, `getRandom()`, `isNotX()`); booleans whose name is the inverse of how they are called (`if (!isInfantAllowed())` style); constants whose value needs an inline comment to explain it; suppliers introducing `guardAgainstX` without naming the rule being enforced.

**Evidence:**
- https://github.com/mventures/genesis/pull/53883#discussion_r3357490711 — "Odd name; would rename to `supportsCarrier()`"
- https://github.com/mventures/genesis/pull/52961#discussion_r3101714026 — "Would rename to `getSegmentDate()`"
- https://github.com/mventures/genesis/pull/52243#discussion_r2897772641 — "That should not be necessary to comment what this constant represents if it's named properly (perhaps rename to `PNR_DATE_TIME_QUEUED`?)"
- https://github.com/mventures/genesis/pull/52235#discussion_r2897688754 — "Please rename those guards… `guardAgainstInvalidTargetParameters` or something"

**Severity:** nit

**last_evidence_at:** 2026-06-04

---

### R03: Declare a return type on every method and keep finder docblocks accurate

**Rule:** Every method declares a `: <type>` return type, and every record/model declares `@method` docblocks that match what its finders actually return (including the nullable case).

**Why:** Without a return type the IDE and static analyser fall back to `mixed`, and an inaccurate `@method` line on a model lies to every caller about whether the result can be `null`.

**Smell to detect:** A new or touched method with no `: <type>` clause; a record class whose `@method static … getOne(...)` docblock omits the `|null`; a console script, test, or command issuer added without a return type. Concentrates in `src/Console/Scripts/**`, FareFetch records, and command issuer result classes.

**Evidence:**
- https://github.com/mventures/genesis/pull/53000#discussion_r3101654483 — "Missing return type"
- https://github.com/mventures/genesis/pull/52237#discussion_r2913556699 — "While revisiting this method, we could add a return type"
- https://github.com/mventures/genesis/pull/52324#discussion_r2920006063 — "`@method static Mv_Ota_Rule_FareFetch_Target_Record|null getOne($spec, $fetch = null)`"
- https://github.com/mventures/genesis/pull/52479#discussion_r2954731160 — "Would add `airline_supported_trickle_down` in the docblock of the class"

**Severity:** nit

**last_evidence_at:** 2026-06-03

---

### R04: Do not repeat work the parent class, framework, or caller already does

**Rule:** Before adding an assignment, a guard, or a default, confirm the parent class, the framework, or the upstream caller has not already done it.

**Why:** Duplicating an upstream assignment or check makes the data flow ambiguous — readers cannot tell which write wins and which guard is load-bearing.

**Smell to detect:** A subclass constructor that re-assigns a property the parent already set; a method body that re-tests a condition the caller just tested; a per-row check inside a loop where the surrounding method already filtered the same condition; a second `if`/`match` block immediately after a guard that repeats the same checks to derive a message. Concentrates in `src/Booking/**`, optimizer reprice flow, and command issuers.

**Evidence:**
- https://github.com/mventures/genesis/pull/52703#discussion_r3088031317 — "The `parent` takes care of this assignment"
- https://github.com/mventures/genesis/pull/53428#discussion_r3320388702 — "Code below returns 0 if it catches an `Exception`, so this test is redundant"
- https://github.com/mventures/genesis/pull/51819#discussion_r2812621535 — "Or use parent's `getOneBy()`"
- https://github.com/mventures/genesis/pull/52283#discussion_r2914282535 — "Could be moved to parent"
- https://github.com/mventures/genesis/pull/53962#discussion_r3391081885 — "Instead of retesting the conditions above, one could test if there's a message returned from matching any of the conditions"

**Severity:** nit

**last_evidence_at:** 2026-06-10

---

### R05: Extract repeated logic into a helper, parent, or interface — no copy-paste across suppliers

**Rule:** When the same formula or operation appears in two suppliers, two operations, or two helpers, extract it into a base class, a trait, or a shared helper method.

**Why:** Supplier integrations multiply quickly; each copy-pasted formula becomes another place to update on the next pricing or schedule change, and the copies drift silently.

**Smell to detect:** Identical or near-identical method bodies in two `src/Supplier/<X>/**` classes; the same arithmetic appearing in a new supplier that already exists in a sibling supplier or a `Helpers/` class; per-supplier reimplementations of a generic equipment / fare / segment transform. Concentrates in `src/Supplier/Downtowntravel/**`, `src/Supplier/Dida/**`, `src/Supplier/FarelogixNDC/**`, and `src/Flight/Search/FareFetch/Supplier/**`.

**Evidence:**
- https://github.com/mventures/genesis/pull/53781#discussion_r3319961501 — "Wait… same formula, but copy/pasted. This is a helper class. Why can't we come up with a… helper method doing this calculation?"
- https://github.com/mventures/genesis/pull/52961#discussion_r3101851510 — "Copy/pasted; please make a reusable method"
- https://github.com/mventures/genesis/pull/53407#discussion_r3228201139 — "For equipment; that helper should be extract because it has barely anything to do with Amadeus"
- https://github.com/mventures/genesis/pull/51819#discussion_r2822999361 — "That's a lot of copy pasted code I see from one PR to another; can't we figure out the common traits and start re-using from an abstract or something?"

**Severity:** nit

**last_evidence_at:** 2026-05-29

---

### R06: Default classes to `final`; in a `final` class prefer `static` over `self` and `private` over `protected`

**Rule:** Mark every new class `final` unless a subclass exists; once `final`, drop the redundant `static` keyword on calls that cannot be inherited, return `static` (not `self`) from factories, and demote `protected` members to `private` when no subclass uses them.

**Why:** Without `final`, late-static-binding bugs slip in when a subclass appears later — `new self()` and `self::foo()` quietly skip the subclass override; meanwhile `protected` and `static` on a `final` class are misleading visibility cues that imply an inheritance contract that does not exist.

**Smell to detect:** A new class declaration without the `final` keyword in `src/Supplier/**` or `include/Mv/Ota/**`; `new self(...)` or `self::create(...)` inside a non-`final` class or an abstract factory; `protected` members in a `final` class with no subclass; `public static function` inside a `final` class that is only called from the same class.

**Skip if:**
- The class is registered in a factory map keyed on the class string (`*Factory::*_CLASSES = [… => X::class]`, `Mv_Ota_Air_Ticketer_Manager::TICKETER_CLASSES`, `CommandIssuerFactory::SESSION_CLASSES` / `::PNR_CLASSES` / `::QUEUE_CLASSES`) — JP accepts non-`final` here because future suppliers / GDSs subclass the base. See https://github.com/mventures/genesis/pull/53962#discussion_r3403695154 ("evidence provided is from a different context").
- The only signal is "no `final` keyword". The rule's evidence is conditional ("when members are final…", "when using `self`…", "when returning from a factory interface…") — emit `weak` unless the class also exhibits one of the conditional cues (uses `self::`, has all-`final` members, is a factory return type, or returns `static`).

**Evidence:**
- https://github.com/mventures/genesis/pull/53655#discussion_r3304839055 — "Why not make the class `final` at this point?"
- https://github.com/mventures/genesis/pull/52636#discussion_r2997097295 — "When class is final, `static` is redundant (applies to the other usages in the class, except those that are inherited)"
- https://github.com/mventures/genesis/pull/52361#discussion_r2932008015 — "If we're going to use `self`, would make the class `final`, otherwise, would use `static`"
- https://github.com/mventures/genesis/pull/52839#discussion_r3081626956 — "Please revisit this `interface`; the `create()` method should return `static`, not `self` and inheriting classes can keep returning `static` as well"

**Severity:** nit

**last_evidence_at:** 2026-05-27

---

### R07: Declare a shared constant or mapping once in the parent or single source of truth

**Rule:** A constant or lookup mapping that belongs to a family of suppliers, offices, or affiliates is declared once on the parent class, a shared helper, or an existing enum — not redeclared in every subclass.

**Why:** Re-declaring the same `const` in every subclass means the next change has to touch every supplier, and a missed copy leaves one supplier on the old value.

**Smell to detect:** The same `const NAME = '…'` repeated across sibling classes under `src/Supplier/<family>/**`; a hand-written array mapping that mirrors values already declared as constants elsewhere (e.g. `Mv_Ota_Affiliate` IDs); a subclass that redeclares a parent constant with the same value.

**Evidence:**
- https://github.com/mventures/genesis/pull/53026#discussion_r3113350014 — "Why can't these constants be declared in the parent? Everyone builds the same package and yet every class is declaring the same constants over and over"
- https://github.com/mventures/genesis/pull/53403#discussion_r3228408265 — "Can't we use `Mv_Ota_Affiliate` constants?"
- https://github.com/mventures/genesis/pull/53183#discussion_r3163135504 — "Can't this mapping be declared as a constant? It's only written two here and the mapping could be declared right below the list of PCC constants"
- https://github.com/mventures/genesis/pull/53178#discussion_r3156265808 — "Those constants could be declared in their respective cache classes as a new subtype requires a change in the store"

**Severity:** nit

**last_evidence_at:** 2026-05-19

---

### R08: Inject collaborators through the constructor; do not `new` them or pull them from globals

**Rule:** Pass HTTP clients, Redis registries, loggers, and token helpers as constructor parameters that default to the production implementation, so tests can swap them out.

**Why:** A class that hard-codes `new Curl()` or reads from a static registry is impossible to test without spinning up the real dependency, and ends up untested as a result.

**Smell to detect:** `new <Client>()` or `new <Registry>()` inside a method body of a service / helper class; `<Class>::staticMethod()` calls reaching into a singleton registry from inside an instance method; a constructor that takes no collaborator parameter despite the class talking to Redis, an API, or a logger.

**Skip if:**
- The class is instantiated through a factory map keyed on a GDS / supplier / type code (`Mv_Ota_Air_Ticketer_Manager::TICKETER_CLASSES`, `CommandIssuerFactory::SESSION_CLASSES` / `::PNR_CLASSES`, any `match`/`switch` over `Mv_Ota_Booking::GDS_*` that does `new $class(...)`) — the factory contract fixes the constructor signature, so adding an optional collaborator parameter requires a cross-cutting refactor that belongs in its own PR. See https://github.com/mventures/genesis/pull/53962#discussion_r3403722002 ("This cannot work unless the ticketed manager is reworked as it behave like a factory").

**Evidence:**
- https://github.com/mventures/genesis/pull/53407#discussion_r3228111649 — "Why is everything `static`? The Redis registry is instantiated every single time a read or write request is issued… it should be injected as a dependency instead (allowing for… tests!)"
- https://github.com/mventures/genesis/pull/53176#discussion_r3197104731 — "`public function __construct(private readonly ?ClientInterface $transportClient = new Curl())`"
- https://github.com/mventures/genesis/pull/52961#discussion_r3133268281 — "Would add 2nd parameter `?ClientInterface $transportClient = null` to allow for dependency injection (say, in tests, if we ever have them one day)"
- https://github.com/mventures/genesis/pull/53424#discussion_r3248551557 — "How about injecting an `Api` (that defaults to `null`, null-coalesced to a new API instance)?"

**Severity:** nit

**last_evidence_at:** 2026-05-15

---

### R09: Delete code that is not called

**Rule:** Remove controllers, methods, constants, parameters, and `@throws` declarations that no caller invokes — do not leave them "for later".

**Why:** Dead code keeps appearing in greps, forces every refactor to consider paths nothing uses, and hides which surface is actually live in production.

**Smell to detect:** A method, constant, or class added or touched in the PR with no callers in the rest of the diff or the surrounding package; a `throws X` declaration on a method whose body cannot reach the `throw`; a controller file under `include/Mv/Ota/**` whose route is no longer wired; unused `use` statements or unused method parameters; a fluent setter that returns `self` / `static` whose return value is never chained at any call site.

**Evidence:**
- https://github.com/mventures/genesis/pull/52961#discussion_r3101677774 — "This controller is no longer used; should update `include/Mv/Ota/Api/App/Optimizer.php`"
- https://github.com/mventures/genesis/pull/53407#discussion_r3228190732 — "Unused"
- https://github.com/mventures/genesis/pull/52535#discussion_r2975009502 — "Never used"
- https://github.com/mventures/genesis/pull/52262#discussion_r2907672189 — "This method can be removed maybe?"
- https://github.com/mventures/genesis/pull/53962#discussion_r3390962429 — "Return value is never used"

**Severity:** nit

**last_evidence_at:** 2026-06-10

---

### R10: Narrow visibility — make members `private` when used only internally, and justify any `protected` → `public` widening

**Rule:** A member used only inside its own class is `private`; a member redeclared from `protected` to `public` needs a stated reason in the PR description, and "to make tests easier" is not one — restructure the test instead.

**Why:** Over-broad visibility commits to an external contract that does not exist, blocks future renames, and quietly turns internal helpers into supplier-facing API surface.

**Smell to detect:** A `public` or `protected` method or property that has no caller outside the class in the diff or surrounding package; a subclass that redeclares a parent member with a wider visibility; a `protected` member on a `final` class that no subclass references.

**Evidence:**
- https://github.com/mventures/genesis/pull/53407#discussion_r3228236113 — "Could be `private`"
- https://github.com/mventures/genesis/pull/52961#discussion_r3101729356 — "Why the redeclaration? And why from `protected` to `public`?"
- https://github.com/mventures/genesis/pull/53026#discussion_r3118730151 — "Used internally only (could be private); class is already final"
- https://github.com/mventures/genesis/pull/53260#discussion_r3173803011 — "Leverage Redis namespaces: `private const string REDIS_KEY_PREFIX = 'downtowntravel_verify_price:';`"

**Severity:** nit

**last_evidence_at:** 2026-05-14

---

### R11: Drop redundant casts and coercions — let the declared types do the work

**Rule:** Do not write `(string)null`, `(int)$x ?? 0`, `(bool) $record->flag ?? false`, or argument values equal to the parameter's declared default — the declared type already coerces or short-circuits.

**Why:** Redundant casts add noise without changing behaviour and signal that the author did not read the declared types, which masks the real coercion bugs that actually need a cast.

**Smell to detect:** `(string)null`, `(string)$x` where `$x` is already a string, `(bool) $record->boolField ?? false`, `intval($x) ?? 0`; a function call whose argument matches the parameter's declared default; a `?? 0` on a property already typed `int`. Concentrates in `src/Supplier/Sabre/**`, `src/Supplier/TravelportPlusNdc/**`, and `include/Mv/Ota/Rule/FareFetch/**`.

**Evidence:**
- https://github.com/mventures/genesis/pull/52574#discussion_r2981834786 — "If this is a property of the record, there's no need to null-coalesce, as `(bool)null` is `false` anyway: `return (bool) $this->include_multi_tickets;`"
- https://github.com/mventures/genesis/pull/53407#discussion_r3228209137 — "Concatenating `null` is fine, no need to cast to string (it will coerce to `''` automatically"
- https://github.com/mventures/genesis/pull/52489#discussion_r2961063002 — "1. (string)null => '' 2. (string)$result => the result as string"
- https://github.com/mventures/genesis/pull/51819#discussion_r2932504623 — "The cast is redundant because the parameter will force the value to be coerced (here to `?int`)"

**Severity:** nit

**last_evidence_at:** 2026-05-14

---

### R12: Replace magic literals with named constants, enum cases, or shared keys

**Rule:** Redis key prefixes, status literals, fare-type strings, segment / coupon status codes, and affiliate IDs go behind a named constant or enum case — both in production code and in tests.

**Why:** A bare literal hides where the value comes from, so the next time the value changes the grep misses one site and the system goes inconsistent.

**Smell to detect:** A string literal used as a Redis prefix, cache key, status code, or fare-type name; a literal value in a test whose production counterpart is already a constant; a hand-written list of affiliate IDs that mirrors an existing `Mv_Ota_Affiliate` constant set; a numeric or string flag passed to a switch / match without being named.

**Evidence:**
- https://github.com/mventures/genesis/pull/53403#discussion_r3229061253 — "Or use a constant somewhere? Could be declared in `Mv_Ota_Affiliate`: `static $affiliateIds = [ … ];`"
- https://github.com/mventures/genesis/pull/52577#discussion_r2982806998 — "There are literals that could be replaced with their respective constants (namely segment and coupon statuses)"
- https://github.com/mventures/genesis/pull/52961#discussion_r3101746519 — "Could use the package's constant for this key"
- https://github.com/mventures/genesis/pull/52122#discussion_r2884078436 — "Those should be a in separate enum"

**Severity:** nit

**last_evidence_at:** 2026-05-13

---

### R13: Prefer `tryFrom` or a `TYPES` map over `switch` / `if` ladders and trivial `match` blocks

**Rule:** When the dispatch shape is "given enum/string X, do Y", use `Enum::tryFrom($x) ?? <default>` or a `TYPES` map keyed by `$x`; for two cases, use a ternary instead of `match`.

**Why:** A `TYPES` map turns "add a new provider" into a single-line change; a `switch`/`if` ladder forces a new branch in every dispatcher and tends to drift between siblings.

**Smell to detect:** A `match` or `switch` whose cases all do `new <Class>(...)` with the same argument shape; a `switch` over an enum without an `Enum::tryFrom` fallback for the unrecognised case; a two-arm `match` that could be a ternary; a per-supplier dispatch method that grows a new arm with every new supplier.

**Evidence:**
- https://github.com/mventures/genesis/pull/52839#discussion_r3081813005 — "No need for a `match` here, just resolve a `$class` from `TYPES` and instantiate with `new $class($data ?? [])`, so adding a provider only requires a single change"
- https://github.com/mventures/genesis/pull/52122#discussion_r2884084695 — "What if the reason is unrecognized? Would `tryFrom` and null-coalesce to a default value"
- https://github.com/mventures/genesis/pull/52700#discussion_r3017894682 — "For 2 cases, would favor `? :` instead of `match`"
- https://github.com/mventures/genesis/pull/52703#discussion_r3059369837 — "Should be called `resolveRetryReason()` or something indicating what this is all about; `match()` is super vague"

**Severity:** nit

**last_evidence_at:** 2026-04-20

---

### R14: Eager-load related rows and pick the cheapest finder for the question

**Rule:** Reads that fan out per row eager-load their relations; choose `getCount()` over `getOne()->count`, `pluck('id')` over loading whole records; and assert `protected bool $checkSqlLogs = true;` in unit tests so an accidental query is caught.

**Why:** A per-row finder inside a loop produces dozens of SQL queries against optimizer attempts and admin pages, and the regression only shows up in production timing.

**Smell to detect:** A `foreach` over records that calls a finder on each iteration without an `eager: […]` option; a `getOne()` call whose result is only used for `->count` or `->id`; a test class that touches DB code without `protected bool $checkSqlLogs = true;`. Concentrates in optimizer attempt rendering, fare-fetch admin, and `src/Console/Scripts/**`.

**Evidence:**
- https://github.com/mventures/genesis/pull/51548#discussion_r3022466853 — "eager loading or else the attempt package makes dozens of SQL queries to retrieve the candidate pivots with routehappy documents"
- https://github.com/mventures/genesis/pull/52965#discussion_r3094399028 — "Actually, it's cheaper to use `getCount()` than `getOne()`"
- https://github.com/mventures/genesis/pull/52575#discussion_r3011635361 — "Or `$alertEmailList->pluck('id')`"
- https://github.com/mventures/genesis/pull/52479#discussion_r2954728813 — "Would add `protected bool $checkSqlLogs = true;` to make sure your tests are not running SQL queries"

**Severity:** nit

**last_evidence_at:** 2026-04-16

---

### R15: Report recoverable errors to APM via `topThrowable` / `topNonException`; do not catch `Throwable` and do not `throw` from a flow that should keep going

**Rule:** Send recoverable errors to APM with the throwable attached using `Apm::traceable()->topThrowable($e)` or `topNonException($e)`; catch the concrete exception type, not `Throwable`; and do not `throw` from a path that is supposed to fall back.

**Why:** `topUserError` and a swallowed `catch (Throwable)` hide language-level errors (division by zero, type errors, assertion failures) behind a user-facing message, and a `throw` inside a fallback path breaks the very flow the fallback exists to protect.

**Smell to detect:** `catch (Throwable $e)` in supplier or booker code; `Apm::traceable()->topUserError(...)` instead of `topThrowable(...)` for an exception that originated below the user; a `throw new X` inside a `try` whose surrounding flow is the recovery path; an exception caught and only logged without the throwable being attached. Concentrates in `src/Supplier/Tiantai/**`, `src/Supplier/FarelogixNDC/**`, `include/Momentum/SelfServe/**`, and `include/Mv/Ota/Air/Booker/**`.

**Evidence:**
- https://github.com/mventures/genesis/pull/53764#discussion_r3313222883 — "This could happen A LOT… Why not report the exception instead? Use `topThrowable()` instead of `topUserError()`"
- https://github.com/mventures/genesis/pull/52550#discussion_r2976146461 — "I would recommend catching something else than `Throwable` as this will silence everything that's not an `Exception`"
- https://github.com/mventures/genesis/pull/53251#discussion_r3250912363 — "Throwing now breaks the flow; would instead report the exception to APM with `Apm::traceable()->topThrowable($e);`"
- https://github.com/mventures/genesis/pull/52088#discussion_r2854209020 — "Exceptions should be reported as such to the APM, otherwise we lose the callstack (`Apm::traceable()->topThrowable()`)"

**Severity:** nit

**last_evidence_at:** 2026-05-28

---

### R16: Put a method on the class that owns the data it mutates

**Rule:** A method lives on the class whose data it mutates — optimizer logic does not live in the API controller, merchant-fee logic does not live in the optimizer, and supplier-specific seat data does not live in a generic helper.

**Why:** Misplaced responsibility couples two layers that should evolve independently, so every change to the data shape forces a change in the wrong file and reviewers spend the cycle re-locating the logic.

**Smell to detect:** A method on an API controller that orchestrates optimizer / package work end-to-end; a method on the optimizer that mutates merchant-fee fields that belong to the reprice / pricing layer; a method on a generic helper that switches on supplier name; a Booker method that reaches into a package to set fields a Reprice method already owns.

**Evidence:**
- https://github.com/mventures/genesis/pull/53403#discussion_r3228351301 — "Why is this it the optimizer's job to add the merchant fee to the package? Reprice methods are updating the fares and calculating the merchant fee…"
- https://github.com/mventures/genesis/pull/52961#discussion_r3101862844 — "Why is the API responsible to optimizer a package?"
- https://github.com/mventures/genesis/pull/51078#discussion_r2611605370 — "Make `Momentum\Optimizer\Repricer\NewOptimizerRepricer::getOfficeCurrency()` `protected` + `static` and move it to `Momentum\Optimizer\OptimizerRepricer`"
- https://github.com/mventures/genesis/pull/51071#discussion_r2611352602 — "Would move the logger call to `__construct()`"

**Severity:** nit

**last_evidence_at:** 2026-05-13

---

### R17: Make value-holder fields `public readonly` in a promoted constructor, and drop the getter

**Rule:** A class whose job is to carry data declares its fields as `public readonly` in a promoted constructor; when every field is immutable, mark the whole class `readonly` and remove the getter / setter pair.

**Why:** A `readonly` property cannot be mutated after construction, so a getter adds no encapsulation — it is pure boilerplate that hides which fields the class actually exposes and forces every caller through an extra method.

**Smell to detect:** A new request / DTO / value object under `src/Supplier/<X>/Api/Operations/**`, `src/Supplier/Amadeus/SoapApi/**`, `src/GdsCommandIssuer/**`, or `src/Booking/**` that declares a `private readonly` field plus a one-line `get<Field>()` method; a constructor body that only assigns `$this->field = $field` for every parameter (should be promoted); a class with no mutators that is not marked `readonly`.

**Skip if:**
- ≥2 sibling DTOs in the same package directory (`src/Supplier/<X>/Operation/**/Request.php`, `src/Supplier/<X>/Api/Operations/<Op>/Request.php`) already use the fluent-setter pattern and call sites chain `->setX()->setY()` — package-level consistency wins over per-class promotion. See https://github.com/mventures/genesis/pull/53962#discussion_r3403713863 ("every sibling operation… uses the fluent-setter pattern, and call sites chain `->setCustomerOrderId()->setPnrCode()`. Changing one breaks consistency.").

**Evidence:**
- https://github.com/mventures/genesis/pull/50586#discussion_r2550770213 — "Or make the class `readonly` and keep properties `public`, no need for getters"
- https://github.com/mventures/genesis/pull/51618#discussion_r2743640702 — "Properties could be promoted in the constructor directly"
- https://github.com/mventures/genesis/pull/51786#discussion_r2775614697 — "If `$pnr` is readonly, then it cannot be mutated; it might as well be public and we can ditch the getter below"
- https://github.com/mventures/genesis/pull/52094#discussion_r2855126408 — "Might as well make the whole class readonly at this point"

**Severity:** nit

**last_evidence_at:** 2026-02-25

---

### R18: Self-identify a log call site with `__METHOD__` or `callee()`, not a hand-written headline string

**Rule:** Use `__METHOD__` (or `callee()` from inside a closure / free function) as the log message identifier instead of a hand-written headline string.

**Why:** A hand-written headline drifts from the method name on every rename and tells the on-call reader nothing about where the log originates; `__METHOD__` / `callee()` self-identify the call site and stay correct under refactor.

**Smell to detect:** A log / event call whose first positional or `message:` argument is a literal string describing the action (`"check-in modify"`, `"booker save failed"`, `headline(...)`); a `Psr\Log` call with a one-line label that duplicates the enclosing method name; a log inside a closure or free function that uses a literal string when `callee()` would resolve to the caller frame.

**Evidence:**
- https://github.com/mventures/genesis/pull/49839#discussion_r2510659181 — "You can also use `callee()` to get the stack's context (in this case, `Momentum\\Booking\\Package\\Commission\\Builder::apply()`)"
- https://github.com/mventures/genesis/pull/50783#discussion_r2586362408 — "Or `$context = callee(1);`"
- https://github.com/mventures/genesis/pull/51840#discussion_r2813723835 — "`headline()` is cute but it doesn't leave much behind in terms of 'Where is this log from?' … `message: callee()`"
- https://github.com/mventures/genesis/pull/52123#discussion_r2861498699 — "When `__METHOD__` is not applicable (because inside a callable or not in a class), `callee()` does the job just fine"

**Severity:** nit

**last_evidence_at:** 2026-02-27
