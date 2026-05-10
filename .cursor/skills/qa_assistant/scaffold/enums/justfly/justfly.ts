/**
 * JustFly-specific constants.
 *
 * UI message strings, route paths, and storage-state paths that are unique
 * to the JustFly frontend. For genesis-backend API endpoints shared with
 * Flighthub, see `enums/shared/genesis.ts`. For roles, see `enums/util/roles.ts`.
 *
 * @example
 * ```ts
 * import { Messages } from '../../enums/justfly/justfly';
 * await expect(page.getByText(Messages.HOME_HEADING)).toBeVisible();
 * ```
 */

/**
 * JustFly UI message strings (verified against live staging2 snapshots
 * via `playwright-cli` 2026-05-09). The JustFly storefront ships from
 * the same `genesis-storefront` codebase as Flighthub, so the home /
 * search / checkout / booking-confirmation chrome strings are largely
 * identical between the two brands. Where strings genuinely differ
 * (brand-only chrome, currency display, page titles), the JustFly
 * value lives here verbatim — never copied wholesale from the
 * Flighthub enum.
 */
export enum Messages {
    HOME_HEADING = 'Find cheap flights and save',
    COOKIE_REJECT_ALL = 'Reject All',
    SEARCH_VALIDATION_MODAL_HEADING = "Oops! Looks like we're missing some crucial information to find your flight:",
    SEARCH_ORIGIN_REQUIRED = 'You must enter a departure airport',
    SEARCH_DESTINATION_REQUIRED = 'You must enter an arrival airport',
    // Surfaced when the user commits the same IATA in both origin and
    // destination via the autocomplete dropdown (the only validation
    // path the storefront's auto-fill cannot mask on staging2 — see
    // tests/justfly/functional/search.spec.ts).
    SEARCH_AIRPORTS_NOT_DIFFERENT = 'You must select different departure and arrival airports',

    // Home-page form-control labels (verified 2026-05-09 via
    // playwright-cli on staging2). Used by the home page object's
    // interactive surfaces — date picker, passengers popover, cabin
    // dropdown, multi-city slices, and header chrome (sign-in modal
    // heading).
    HOME_SIGN_IN_DIALOG_HEADING = 'Sign in or register!',
    HOME_PAX_ADULT_LABEL = 'Adult (12+)',
    HOME_PAX_CHILD_LABEL = 'Child (2-11)',
    HOME_PAX_INFANT_SEAT_LABEL = 'Infant on seat (under 2)',
    HOME_PAX_INFANT_LAP_LABEL = 'Infant on lap (under 2)',
    // Default value the storefront writes back into the passengers field
    // when counts collapse to (1 ADT, 0 CHD, 0 INF).
    HOME_PAX_DEFAULT_DISPLAY = '1 Adult',
    HOME_CABIN_ECONOMY = 'Economy',
    HOME_CABIN_PREMIUM_ECONOMY = 'Premium Economy',
    HOME_CABIN_BUSINESS = 'Business Class',
    HOME_CABIN_FIRST = 'First Class',
    HOME_MULTI_CITY_SLICE_TITLE_PREFIX = 'Flight ',

    // Flight-search results filter sidebar / pagination labels (shared
    // genesis-storefront codebase between Flighthub and JustFly; verbatim
    // strings live on both brands).
    SEARCH_RESULTS_LOADING = 'Searching...',
    SEARCH_RESULTS_FILTER_HEADING = 'Filter your results',
    SEARCH_RESULTS_BACK_TO_SEARCH = 'Back to search',
    SEARCH_RESULTS_NO_FLIGHTS_HEADING = 'No flights found',
    // Curly apostrophe (\u2019) is what the storefront renders — match exactly.
    SEARCH_RESULTS_NO_FLIGHTS_BODY = 'Sorry, we couldn\u2019t find any flights matching your search criteria. Try selecting different dates or nearby places.',
    SEARCH_RESULTS_BUNDLE_CONTINUE_FLIGHT_ONLY = 'Continue with flight only',
    SEARCH_RESULTS_FARE_CONTINUE_TO_CHECKOUT = 'Continue to checkout',
    SEARCH_RESULTS_FILTER_STOPS = 'Stops',
    SEARCH_RESULTS_FILTER_AIRLINES = 'Airlines',
    SEARCH_RESULTS_FILTER_FLIGHT_TIMES = 'Flight Times',
    SEARCH_RESULTS_FILTER_PRICE = 'Price',
    SEARCH_RESULTS_FILTER_AIRPORTS = 'Airports',
    SEARCH_RESULTS_STOPS_NONSTOP = 'Nonstop',
    SEARCH_RESULTS_STOPS_ONE = '1 Stop',
    SEARCH_RESULTS_STOPS_TWO_PLUS = '2+ Stops',
    SEARCH_RESULTS_FLIGHT_TIMES_DEPARTURE_TAB = 'Departure',
    SEARCH_RESULTS_FLIGHT_TIMES_ARRIVAL_TAB = 'Arrival',
    SEARCH_RESULTS_AIRPORTS_INCLUDE_NEARBY = 'Include flights to/from nearby airports',
    SEARCH_RESULTS_AIRPORTS_SAME = 'Same airport for departure and return',
    SEARCH_RESULTS_AIRLINES_SHOW_ALL = 'Show all airlines',
    SEARCH_RESULTS_CLEAR_ALL = 'Clear all',
    SEARCH_RESULTS_LOAD_MORE = 'Load more',
    SEARCH_RESULTS_SORT_BEST = 'Best',
    SEARCH_RESULTS_SORT_CHEAPEST = 'Cheapest',
    SEARCH_RESULTS_SORT_SHORTEST = 'Shortest',
    SEARCH_RESULTS_SORT_FLEXIBLE = 'Flexible',
    SEARCH_RESULTS_HEADER_LEAVING_FROM = 'Leaving from',
    SEARCH_RESULTS_HEADER_GOING_TO = 'Going to',
    SEARCH_RESULTS_HEADER_SEARCH_BUTTON = 'Search',
    SEARCH_RESULTS_RESULT_SELECT = 'Select',
    SEARCH_RESULTS_SHOW_FLIGHT_DETAILS = 'Show flight details',
    SEARCH_RESULTS_FARE_ALERTS = 'Get fare alerts',
    SEARCH_RESULTS_STOPS_ONLY = 'only',
    SEARCH_RESULTS_PRICE_DEALS_DIALOG = 'Find out when prices change',
    SEARCH_RESULTS_DIALOG_CLOSE_GLYPH = '\u00d7',

    // Booking-link / fallback expiry copy used by negative checkout tests.
    BOOKING_LINK_EXPIRED = 'We\u2019re sorry! The link you have followed may have expired.',

    // ==================== Booking confirmation / trip-detail surface ====================
    // Reached via /service/portal/detail/{id_hash} after a successful
    // checkout or via the email "view your booking" link. Strings are
    // mostly identical to Flighthub's surface (shared genesis-storefront
    // codebase) — the canonical brand difference is the storefront
    // booking-number label below, which uses the lowercase `justfly.com`
    // brand token instead of FlightHub's `FlightHub` token.
    BOOKING_NUMBER_LABEL = 'justfly.com Booking Number:',
    BOOKING_HEADING_PREFIX = 'Booking #',
    BOOKING_STATUS_CONFIRMED = 'Booking status: Confirmed',
    BOOKING_STATUS_CANCELLED = 'Booking status: Cancelled',
    BOOKING_WELCOME_HEADING = 'Welcome!',
    BOOKING_CONFIRMED_BANNER = 'Your booking was successfully completed!',
    BOOKING_PRINT_LINK = 'Print',
    BOOKING_SHARE_LINK = 'Share',
    BOOKING_DOWNLOAD_INVOICE_LINK = 'Download invoice',
    BOOKING_QUICK_ACTION_HOTELS = 'Hotels',
    BOOKING_QUICK_ACTION_CAR_RENTALS = 'Car Rentals',
    BOOKING_QUICK_ACTION_SEAT_REQUESTS = 'Seat Requests',
    BOOKING_QUICK_ACTION_PROTECT_MY_TRIP = 'Protect My Trip',
    BOOKING_QUICK_ACTION_TRAVELLER_DETAILS = 'Traveller Details',
    BOOKING_QUICK_ACTION_TRAVEL_REQUIREMENTS = 'Travel Requirements',
    BOOKING_QUICK_ACTION_BOOK_AGAIN = 'Book Again',
    BOOKING_QUICK_ACTION_FLIGHT_ENHANCERS = 'Flight Enhancers',
    BOOKING_QUICK_ACTION_THINGS_TO_DO = 'Things to do',
    BOOKING_ITINERARY_HEADING = 'My itinerary',
    // The "Departure" slice header on the booking trip-detail surface
    // and the "Departure" tab in the search-results flight-times
    // filter chrome are unrelated UI strings that happen to share the
    // same word. Declaring a dedicated member keeps the booking
    // assertion from silently following any future drift in the
    // search-results filter copy.
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values -- distinct UI surface from SEARCH_RESULTS_FLIGHT_TIMES_DEPARTURE_TAB; same word, different feature.
    BOOKING_ITINERARY_SLICE_DEPARTURE = 'Departure',
    BOOKING_ITINERARY_SLICE_RETURN = 'Return',
    BOOKING_ITINERARY_AIRLINE_CONFIRMATION_PREFIX = 'Airline confirmation:',
    BOOKING_FLIGHT_ENHANCERS_HEADING = 'Flight enhancers',
    BOOKING_BAGGAGE_COL_AIRLINE = 'Airline',
    BOOKING_BAGGAGE_COL_ROUTE = 'Route',
    BOOKING_BAGGAGE_COL_CARRY_ON = 'Carry On',
    BOOKING_BAGGAGE_COL_FIRST_CHECKED = '1st Checked Bag',
    BOOKING_BAGGAGE_COL_SECOND_CHECKED = '2nd Checked Bag',
    BOOKING_BAGGAGE_COL_THIRD_CHECKED = '3rd Checked Bag',
    BOOKING_BAGGAGE_VIEW_POLICY = 'View Policy',
    BOOKING_FLIGHT_INFORMATION_HEADING = 'Flight information',
    BOOKING_FARE_RULES_HEADING = 'Fare Rules and Restrictions:',
    BOOKING_TRAVELLERS_HEADING = 'Travellers',
    BOOKING_TRAVELLER_INCORRECT_NAME_HINT = 'See an incorrect name? Please chat with us. Fees may apply.',
    BOOKING_TRAVEL_REQUIREMENTS_HEADING = 'Travel requirements',
    BOOKING_TRAVEL_VISA_BUTTON = 'Apply for a travel visa',
    BOOKING_E_TICKETS_HEADING = 'E-Tickets',
    BOOKING_E_TICKETS_COL_TRAVELER = 'Traveler',
    BOOKING_E_TICKETS_COL_E_TICKET = 'E-Ticket',
    BOOKING_BILLING_HEADING = 'Billing',
    BOOKING_PRICE_DOWNLOAD = 'Download',
    BOOKING_PRICE_EMAIL = 'Email',
    BOOKING_PRICE_ROW_BASE_FARE = 'Base Fare',
    BOOKING_PRICE_ROW_TAXES_AGENCY_FEES = 'Taxes & Agency Fees',
    BOOKING_PRICE_ROW_TOTAL_PER_PERSON = 'Total Per Person',
    BOOKING_PRICE_FINAL_TOTAL = 'Final Total Price',
    BOOKING_SUPPORT_HEADING = 'Support',
    BOOKING_SUPPORT_CENTER_LINK = 'Support Center',
    BOOKING_SUPPORT_UPLOAD_DOCUMENTS_LINK = 'Upload documents',
    BOOKING_REFUND_SUMMARY_HEADING = 'Refund Request Summary',
    BOOKING_REFUND_ESTIMATED_DATE_PREFIX = 'Estimated Refund Date:',
    BOOKING_REFUND_PAYMENT_METHOD_PREFIX = 'Payment method:',
    BOOKING_CANCELLATION_BANNER = 'We have successfully processed your cancellation request. Refunds to credit cards are usually completed within 10 business days. Refunds to debit cards may take up to 30 business days. If you haven\u2019t received your refund within the expected timeframe, please contact us.',
    BOOKING_NOT_FOUND_HEADING = 'We\u2019re sorry! We were unable to retrieve your booking.',

    // Checkout chrome (shared genesis-storefront codebase between
    // Flighthub and JustFly; verbatim strings live on both brands).
    CHECKOUT_PASSENGER_NAME_HINT = "Each passengers' full name must be entered as it appears on their passport or government issued photo ID. Name changes are not permitted after booking.",
    CHECKOUT_TICKET_DELIVERY_HEADING = 'Where should we send your ticket?',
    CHECKOUT_PROCESSING_NOTICE = 'Do not close or leave this page while we are processing your order',

    // Per-field validation strings shown when "Continue to payment" is
    // pressed with empty / invalid passenger or ticket-delivery fields.
    CHECKOUT_FIRST_NAME_REQUIRED = 'Please enter your first name',
    CHECKOUT_LAST_NAME_REQUIRED = 'Please enter your last name',
    CHECKOUT_DATE_OF_BIRTH_REQUIRED = 'Please enter your date of birth',
    CHECKOUT_GENDER_REQUIRED = 'Please select a gender',
    CHECKOUT_PHONE_REQUIRED = 'Please enter a phone number',
    CHECKOUT_EMAIL_REQUIRED = 'Please enter an email address',
    CHECKOUT_EMAIL_INVALID = 'Invalid email address',

    // Passenger / payment / cart / fare-rules surface labels.
    CHECKOUT_PASSENGER_HEADING_PREFIX = 'Passenger ',
    CHECKOUT_PASSENGER_PAX_LABEL_ADULT = 'Adult',
    CHECKOUT_PASSENGER_PAX_LABEL_CHILD = 'Child',
    CHECKOUT_PASSENGER_PAX_LABEL_INFANT_SEAT = 'Infant (in seat)',
    CHECKOUT_PASSENGER_PAX_LABEL_INFANT_LAP = 'Infant (on lap)',
    CHECKOUT_INSURANCE_TIER_CANCELLATION = 'Cancellation Protection',
    CHECKOUT_INSURANCE_TIER_TRAVEL = 'Comprehensive Travel Insurance',
    CHECKOUT_INSURANCE_TIER_BAGGAGE = 'Baggage Tracking',
    CHECKOUT_INSURANCE_DECLINE_CANCELLATION = "No thanks, I don't need protection",
    CHECKOUT_INSURANCE_DECLINE_TRAVEL = "No, I don't need travel insurance",
    CHECKOUT_INSURANCE_DECLINE_BAGGAGE = 'No, I\u2019m willing to risk losing my baggage',
    CHECKOUT_VISA_REQUIREMENTS_HEADING = 'Visa requirements',
    CHECKOUT_VISA_REQUIREMENTS_LINK = 'View travel requirements',
    CHECKOUT_PAYMENT_METHOD_HEADING = 'Payment method',
    CHECKOUT_PAYMENT_METHOD_CARD = 'Credit card',
    CHECKOUT_PAYMENT_METHOD_AFFIRM = 'Affirm',
    CHECKOUT_PAYMENT_METHOD_PAYPAL = 'PayPal',
    CHECKOUT_REVIEW_HEADING = 'Review your itinerary and information',
    CHECKOUT_BOOKING_TERMS_HEADING = 'Booking terms',
    CHECKOUT_FARE_RULES_BUTTON = 'fare rules',
    CHECKOUT_BAGGAGE_FEES_BUTTON = 'baggage fees',
    CHECKOUT_FEES_BUTTON = 'fees',
    CHECKOUT_PRICE_SUMMARY_HEADING = 'Price Summary',
    CHECKOUT_PRICE_ROW_PASSENGERS = 'Passengers',
    CHECKOUT_PRICE_ROW_ADULTS = 'Adults',
    // The 'Child' / 'Adult' / 'Infant ...' row labels reuse the
    // `CHECKOUT_PASSENGER_PAX_LABEL_*` constants above — TypeScript
    // forbids duplicate enum values, and the storefront surfaces the
    // same strings on both the passenger form and the cart summary.
    CHECKOUT_PRICE_ROW_INFANT_SEAT = 'Infant in Seat',
    CHECKOUT_PRICE_ROW_INFANT_LAP = 'Infant on Lap',
    CHECKOUT_PRICE_ROW_TAXES = 'Taxes & Fees',
    CHECKOUT_PRICE_ROW_TOTAL = 'Total',
    CHECKOUT_PROMO_CODE_TOGGLE = 'Promo Code',
    CHECKOUT_PROMO_CODE_PLACEHOLDER = 'Enter your promo code',
    CHECKOUT_PROMO_CODE_APPLY = 'Apply',
    CHECKOUT_TRIP_SUMMARY_HEADING = 'Trip summary',
    CHECKOUT_BAGGAGE_INFO_BUTTON = 'Baggage information',
    CHECKOUT_INFANT_AGE_ERROR = "Infant fare passengers must be under the age of 2 at the departure time of the last flight. Please book this passenger as 'child'.",
    CHECKOUT_DEBUG_PANEL_HEADING = 'Debugging Options',
    CHECKOUT_DEBUG_BOOKING_FAILURE_REASON = 'Booking Failure Reason',
    CHECKOUT_DEBUG_BOOKING_FAILURE_DELAY = 'Booking Failure Delay',
    CHECKOUT_DEBUG_DISABLE_OPTIMIZER = 'Disable Optimizer/Repricer',
    CHECKOUT_DEBUG_DEFAULT_MERCHANT = 'Default Merchant',

    // ==================== Header language / currency dialog ====================
    // Reached by clicking the currency code in the wide-layout header
    // (or its burger-nav duplicate). Opens a non-named `role=dialog`
    // whose title is matched via `hasText` against the heading below.
    // The Currency row is read-only — currency follows the selected
    // Country / Region. Save persists to cookies (`country`,
    // `currency`, `display_currency`) on `.justfly.com` and reloads
    // the page with `?language=...&country=...&currency=...`.
    HEADER_CURRENCY_DIALOG_HEADING = 'Language and Currency',
    HEADER_CURRENCY_DIALOG_COUNTRY_REGION_LABEL = 'Country / Region',
    HEADER_CURRENCY_DIALOG_SAVE = 'Save',
    HEADER_CURRENCY_DIALOG_CANCEL = 'Cancel',
}

/**
 * Currencies the JustFly storefront exposes via the Language and
 * Currency dialog. Each value maps to a country in `COUNTRY_FOR_CURRENCY`
 * below. Verified live against staging2 on 2026-05-10 — the dialog's
 * Country / Region listbox lists exactly United States, Canada, United
 * Kingdom, France, Ireland; France and Ireland both map to EUR (the
 * canonical EUR country picked by the POM is France).
 */
export enum SupportedCurrency {
    USD = 'USD',
    CAD = 'CAD',
    GBP = 'GBP',
    EUR = 'EUR',
}

/**
 * Canonical Country / Region label per supported currency, matched by
 * `getByRole('option', { name, exact: true })` against the dialog
 * listbox. France is the canonical EUR country (Ireland also maps to
 * EUR but is exercised separately in `currencySwitching.spec.ts` as
 * the two-countries-same-currency case).
 */
export const COUNTRY_FOR_CURRENCY: Record<SupportedCurrency, string> = {
    [SupportedCurrency.USD]: 'United States',
    [SupportedCurrency.CAD]: 'Canada',
    [SupportedCurrency.GBP]: 'United Kingdom',
    [SupportedCurrency.EUR]: 'France',
} as const;

/**
 * JustFly frontend route paths (path stems only — tests append query /
 * path segments).
 */
export enum Routes {
    HOME = '/',
    FLIGHT_SEARCH = '/flight/search',
    FLIGHT_CHECKOUT = '/checkout/billing/flight',
    FLIGHT_CHECKOUT_FALLBACK = '/flight/checkout',
    FLIGHT_BOOKING = '/flight/booking',
    PORTAL_DETAIL = '/service/portal/detail',
}

/** Storage state file path for the JustFly authenticated browser context */
export enum StorageStatePaths {
    JUSTFLY = '.auth/justfly/storageState.json',
}
