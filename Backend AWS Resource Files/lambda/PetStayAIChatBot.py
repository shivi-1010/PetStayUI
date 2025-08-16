import os, re, json, urllib.request, urllib.error, urllib.parse, time
from datetime import datetime

API_BASE = os.environ.get("API_BASE_URL", "https://howm2f0jc9.execute-api.us-east-1.amazonaws.com")
FRONTEND_BASE = os.environ.get("FRONTEND_BASE_URL", "https://master.d3lmxb04veurt7.amplifyapp.com")

# ---------- Helpers ----------
def _slot(slots, name):
    s = (slots or {}).get(name) or {}
    v = s.get("value") or {}
    val = (v.get("interpretedValue") or v.get("originalValue") or "").strip()
    return val or None

def _slot_any(slots, names):
    for n in names:
        v = _slot(slots, n)
        if v:
            return v
    return None

def _delegate(intent, slots):
    return {"sessionState": {"dialogAction": {"type": "Delegate"}, "intent": intent}}

def _close(state, message, booking_id="", owner_name="", pending_id=""):
    attrs = {"BookingID": booking_id or "", "OwnerName": owner_name or ""}
    if pending_id:
        attrs["PendingBookingID"] = pending_id
    return {
        "sessionState": {
            "dialogAction": {"type": "Close"},
            "intent": {"name": intent_name(intent=message) if False else "PetStayBooking", "state": state},
            "sessionAttributes": attrs
        },
        "messages": [{"contentType": "PlainText", "content": message}]
    }

# (keep intent name simple; if you prefer to reflect actual name, pass it into _close)
def intent_name(intent=None):  # not used now; kept for clarity
    return "PetStayBooking"

# ---------- HTTP ----------
def _http_post_json(url, payload, timeout=12):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode("utf-8")
            try:
                return r.getcode(), json.loads(txt)
            except json.JSONDecodeError:
                return r.getcode(), txt
    except urllib.error.HTTPError as e:
        b = e.read().decode("utf-8") if hasattr(e, "read") else str(e)
        return e.code, b
    except Exception as e:
        return 0, str(e)

def _http_get_json(url, timeout=8):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

# ---------- Optional: soft normalization for 12h time (does not elicit) ----------
TIME_12H_RE = re.compile(r"^\s*(1[0-2]|0?[1-9]):(00|30)\s*([AaPp][Mm])\s*$")
def _normalize_time_12h(t: str):
    """
    If Lex already restricts to allowed values via custom slot type,
    this should already be good. We just normalize casing/zero padding.
    """
    if not t:
        return t
    m = TIME_12H_RE.match(t)
    if not m:
        return t  # trust Lex; don't block
    hh = int(m.group(1))
    mm = int(m.group(2))
    ap = m.group(3).upper()
    return f"{hh}:{mm:02d} {ap}"

# ---------- Pet photo key validation ----------
# Must include at least one folder (/) and end with a common image extension.
S3_KEY_RE = re.compile(r"^[A-Za-z0-9._/-]+\.(jpg|jpeg|png|webp)$", re.IGNORECASE)

def _looks_like_s3_key(v: str) -> bool:
    return bool(v and "/" in v and S3_KEY_RE.match(v))

# ---------- Fulfillment only (with structured logging) ----------
def _fulfill(intent, session_attributes):
    import json, time, urllib

    def jlog(tag, **fields):
        """Structured JSON logger to help debug Lex flows."""
        try:
            print(f"[{tag}] " + json.dumps(fields, default=str))
        except Exception as e:
            print(f"[{tag}] <log_error> {e} | FIELDS={fields}")

    jlog("START_FULFILL", intent=intent)

    # --- Extract slots ---
    slots   = intent.get("slots") or {}
    owner   = _slot_any(slots, ["petOwnerName", "ownerName"])
    email   = _slot(slots, "email")
    phone   = _slot(slots, "phoneNumber")
    petname = _slot(slots, "petName")
    species = (_slot(slots, "petSpecies") or "").title() if _slot(slots, "petSpecies") else ""
    breed   = _slot(slots, "petBreed") or ""
    age     = _slot(slots, "petAge")
    cin     = _slot(slots, "checkInDate")
    cout    = _slot(slots, "checkOutDate")
    atime   = _normalize_time_12h(_slot(slots, "arrivalTime") or "")

    # --- Photo key: prefer session attribute (real S3 key) over slot (may be 'photouploaded') ---
    pphoto_slot = _slot(slots, "petPhotoKey") or ""
    sa_key = (session_attributes or {}).get("LastUploadedPetPhotoKey") \
             or (session_attributes or {}).get("petPhotoKey") or ""

    if sa_key and _looks_like_s3_key(sa_key):
        pphoto = sa_key
        print("[PHOTO_KEY] using session attribute key:", pphoto)
    else:
        pphoto = pphoto_slot
        print("[PHOTO_KEY] using slot key:", pphoto or "<empty>")

    jlog("SLOTS", ownerName=owner, email=email, phoneNumber=phone, petName=petname,
         petSpecies=species, petBreed=breed, petAge=age,
         checkInDate=cin, checkOutDate=cout, arrivalTime=atime, petPhotoKey=pphoto)

    # --- Validate required fields ---
    required = [
        ("ownerName", owner), ("email", email), ("phoneNumber", phone),
        ("petName", petname), ("petSpecies", species), ("petBreed", breed),
        ("petAge", age), ("checkInDate", cin), ("checkOutDate", cout),
        ("arrivalTime", atime), ("petPhotoKey", pphoto)
    ]
    missing = [name for name, val in required if not val]
    if missing:
        jlog("MISSING_SLOTS", missing=missing)
        return _close("Failed", f"Missing required fields: {', '.join(missing)}. Please start again.")

    # --- Validate the photo key looks like an actual S3 object key ---
    if not _looks_like_s3_key(pphoto):
        jlog("BAD_PHOTO_KEY", received=pphoto, sa_key=sa_key, slot=pphoto_slot)
        return _close(
            "Failed",
            "I couldn’t read the pet photo. Please upload the image and ensure I receive the file key "
            "like 'uploads/cat/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.jpg', then try again."
        )

    age = str(age) if (age not in [None, ""]) else ""

    # --- Prepare API request ---
    payload = {
        "OwnerName": owner, "Email": email, "PhoneNumber": phone,
        "PetName": petname, "PetSpecies": species, "PetBreed": breed,
        "PetAge": age, "CheckInDate": cin, "CheckOutDate": cout,
        "ArrivalTime": atime, "PetPhotoKey": pphoto
    }
    url = f"{API_BASE}/newbooking".replace("//newbooking", "/newbooking")
    jlog("API_REQUEST", url=url, payload=payload)

    # --- HTTP POST with retry ---
    def _post_with_retry(url, payload, timeout=12, attempts=2, backoff=1.5):
        last_status, last_body = None, None
        for i in range(attempts):
            last_status, last_body = _http_post_json(url, payload, timeout=timeout)
            jlog("API_ATTEMPT", attempt=i+1, attempts=attempts, status=last_status, body=last_body)
            if last_status == 200:
                break
            if i < attempts - 1:
                time.sleep(backoff)
        return last_status, last_body

    status, body = _post_with_retry(url, payload, timeout=12, attempts=2, backoff=1.5)
    jlog("API_FINAL", status=status, body=body)

    # --- Fail if API error ---
    if status != 200:
        msg = (body.get("message") if isinstance(body, dict) else str(body)) or "Please try again shortly."
        jlog("BOOKING_FAILED", status=status, message=msg)
        return _close("Failed", f"Couldn’t create your booking right now. {msg}")

    # --- Parse body (string -> dict if needed) ---
    if isinstance(body, str):
        try:
            body = json.loads(body)
            jlog("PARSED_STRING_BODY", parsed=True)
        except json.JSONDecodeError:
            jlog("PARSED_STRING_BODY", parsed=False)

    # --- Extract IDs ---
    booking_id = None
    execution_arn = None
    if isinstance(body, dict):
        booking_id = (
            body.get("BookingID") or body.get("bookingId") or
            (body.get("output") or {}).get("BookingID") or (body.get("output") or {}).get("bookingId") or
            (body.get("data") or {}).get("BookingID") or (body.get("data") or {}).get("bookingId")
        )
        execution_arn = body.get("executionArn") or (body.get("output") or {}).get("executionArn")

    jlog("PARSED_IDS", bookingId=booking_id, executionArn=execution_arn)

    # --- No BookingID but have Step Function ARN → return PENDING immediately (frontend polls) ---
    if not booking_id and execution_arn:
        jlog("PENDING_IMMEDIATE_RETURN", executionArn=execution_arn)
        return {
            "sessionState": {
                "dialogAction": {"type": "Close"},
                "intent": {"name": "PetStayBooking", "state": "Fulfilled"},
                "sessionAttributes": {
                    "OwnerName": owner,
                    "BookingID": "",
                    "PendingBookingID": execution_arn
                }
            },
            "messages": [{
                "contentType": "PlainText",
                "content": "Your booking request has been submitted! We’ll email your reference shortly."
            }]
        }

    # --- Still no BookingID? Treat as error ---
    if not booking_id:
        jlog("NO_BOOKING_ID", reason="API success but missing booking id")
        return _close("Failed", "Booking created but no reference ID returned. Please try again.")

    # --- Success: Return and let frontend redirect ---
    link = f"{FRONTEND_BASE}/customer/booking-success.html?bookingId={booking_id}"
    msg = (
        f"Booking created! Reference: {booking_id}. "
        f"{petname} the {species or 'pet'} from {cin} to {cout}. "
        f"You can view details here: {link}"
    )
    jlog("SUCCESS_RETURN", bookingId=booking_id)

    return {
        "sessionState": {
            "dialogAction": {"type": "Close"},
            "intent": {"name": "PetStayBooking", "state": "Fulfilled"},
            "sessionAttributes": {"OwnerName": owner, "BookingID": booking_id}
        },
        "messages": [{"contentType": "PlainText", "content": msg}]
    }

    # --- HTTP POST with retry ---
    def _post_with_retry(url, payload, timeout=12, attempts=2, backoff=1.5):
        last_status, last_body = None, None
        for i in range(attempts):
            last_status, last_body = _http_post_json(url, payload, timeout=timeout)
            jlog("API_ATTEMPT", attempt=i+1, attempts=attempts, status=last_status, body=last_body)
            if last_status == 200:
                break
            if i < attempts - 1:
                time.sleep(backoff)
        return last_status, last_body

    status, body = _post_with_retry(url, payload, timeout=12, attempts=2, backoff=1.5)
    jlog("API_FINAL", status=status, body=body)

    # --- Fail if API error ---
    if status != 200:
        msg = (body.get("message") if isinstance(body, dict) else str(body)) or "Please try again shortly."
        jlog("BOOKING_FAILED", status=status, message=msg)
        return _close("Failed", f"Couldn’t create your booking right now. {msg}")

    # --- Parse body (string -> dict if needed) ---
    if isinstance(body, str):
        try:
            body = json.loads(body)
            jlog("PARSED_STRING_BODY", parsed=True)
        except json.JSONDecodeError:
            jlog("PARSED_STRING_BODY", parsed=False)

    # --- Extract IDs ---
    booking_id = None
    execution_arn = None
    if isinstance(body, dict):
        booking_id = (
            body.get("BookingID") or body.get("bookingId") or
            (body.get("output") or {}).get("BookingID") or (body.get("output") or {}).get("bookingId") or
            (body.get("data") or {}).get("BookingID") or (body.get("data") or {}).get("bookingId")
        )
        execution_arn = body.get("executionArn") or (body.get("output") or {}).get("executionArn")

    jlog("PARSED_IDS", bookingId=booking_id, executionArn=execution_arn)

    # --- No BookingID but have Step Function ARN → return PENDING immediately (frontend polls) ---
    if not booking_id and execution_arn:
        jlog("PENDING_IMMEDIATE_RETURN", executionArn=execution_arn)
        return {
            "sessionState": {
                "dialogAction": {"type": "Close"},
                "intent": {"name": "PetStayBooking", "state": "Fulfilled"},
                "sessionAttributes": {
                    "OwnerName": owner,
                    "BookingID": "",
                    "PendingBookingID": execution_arn
                }
            },
            "messages": [{
                "contentType": "PlainText",
                "content": "Your booking request has been submitted! We’ll email your reference shortly."
            }]
        }

    # --- Still no BookingID? Treat as error ---
    if not booking_id:
        jlog("NO_BOOKING_ID", reason="API success but missing booking id")
        return _close("Failed", "Booking created but no reference ID returned. Please try again.")

    # --- Success: Return and let frontend redirect ---
    link = f"{FRONTEND_BASE}/customer/booking-success.html?bookingId={booking_id}"
    msg = (
        f"Booking created! Reference: {booking_id}. "
        f"{petname} the {species or 'pet'} from {cin} to {cout}. "
        f"You can view details here: {link}"
    )
    jlog("SUCCESS_RETURN", bookingId=booking_id)

    return {
        "sessionState": {
            "dialogAction": {"type": "Close"},
            "intent": {"name": "PetStayBooking", "state": "Fulfilled"},
            "sessionAttributes": {"OwnerName": owner, "BookingID": booking_id}
        },
        "messages": [{"contentType": "PlainText", "content": msg}]
    }

# ---------- Main ----------
def lambda_handler(event, context):
    print("reqId:", getattr(context, "aws_request_id", "n/a"))
    source = event.get("invocationSource")  # DialogCodeHook or FulfillmentCodeHook
    ss = event.get("sessionState") or {}
    intent = ss.get("intent") or {}
    session_attributes = ss.get("sessionAttributes") or {}

    # If the dialog hook is still wired, do NOT prompt — let Lex handle all slot prompts/cards.
    if source == "DialogCodeHook":
        return _delegate(intent, intent.get("slots") or {})

    # Fulfillment only
    return _fulfill(intent, session_attributes)
