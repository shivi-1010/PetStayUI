import json
import boto3
from datetime import datetime
from boto3.dynamodb.conditions import Attr
import uuid
import qrcode
from io import BytesIO

# AWS clients
dynamodb = boto3.resource('dynamodb')
dynamodb_client = boto3.client('dynamodb')
ses = boto3.client('ses', region_name='us-east-1')
s3 = boto3.client('s3')
eventbridge = boto3.client('events')

# Constants
S3_BUCKET = 'petstay-qr-images'
bookings_table = dynamodb.Table('Bookings')
rooms_table = dynamodb.Table('Rooms')

HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
}

allowed_staff = ["petstayteam@outlook.com", "petstayteam@gmail.com"]


def is_admin(event):
    email = extract_email_from_token(event)
    return email in allowed_staff


def lambda_handler(event, context):
    # Always log the raw event first
    print("Lambda triggered. Raw event:", json.dumps(event))

    # If EventBridge fired it, it won't have httpMethod/path
    if 'detail-type' in event:
        print("EventBridge event detected")
        print("DetailType:", event['detail-type'])
        print("Event Detail:", json.dumps(event['detail']))
        # Example: you could do different logic based on detail-type
        return {
            'statusCode': 200,
            'body': json.dumps({'message': f"Handled EventBridge: {event['detail-type']}"})
        }

    #  Else: normal API Gateway routing
    method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method')
    path = event.get('rawPath') or event.get('path') or event.get('requestContext', {}).get('http', {}).get('path', '')
    print("🔍 API Gateway Path:", path, "Method:", method)

    try:
        segments = path.strip('/').split('/')

        if method == 'GET' and len(segments) == 2 and segments[0] == 'booking':
            booking_id = segments[1]
            return get_single_booking(booking_id)
        elif method == 'GET' and path == '/bookings':
            return get_all_bookings()
        elif method == 'GET' and path == '/rooms/availability':
            return get_room_availability()
        elif method == 'POST' and len(segments) == 3 and segments[0] == 'booking':
            booking_id = segments[1]
            action = segments[2]
            if action == 'confirm':
                return confirm_booking(event, booking_id)
            elif action == 'cancel':
                return cancel_booking(event, booking_id)
            elif action == 'checkout':
                return checkout_booking(event, booking_id)
            elif action == 'checkin':
                return checkin_booking(event, booking_id)
            elif action == 'restore':
                return restore_booking(event, booking_id)

        return {
            'statusCode': 404,
            'headers': HEADERS,
            'body': json.dumps({'message': 'Route not found'})
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'headers': HEADERS,
            'body': json.dumps({'error': str(e)})
        }

def extract_email_from_token(event):
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]["email"]
    except Exception as e:
        print("JWT extraction failed:", e)
        return None


def upload_qr_to_s3(qr_data):
    key = f"qr-codes/{uuid.uuid4()}.png"
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=qr_data,
        ContentType='image/png',
        CacheControl='max-age=31536000', 
    )
    return key

def generate_presigned_url(key, expiration=604800):
    url = s3.generate_presigned_url(
        ClientMethod='get_object',
        Params={
            'Bucket': S3_BUCKET,
            'Key': key
        },
        ExpiresIn=expiration
    )
    return url

def send_confirmation_email(owner_name, booking_id, qr_url):
    qr_link = f"https://master.d3lmxb04veurt7.amplifyapp.com/checkin.html?bookingId={booking_id}"
    error = "Unknown error"

    body_html = f"""
    <html>
      <body style="font-family: Arial, sans-serif;">
        <h2 style="color: #2e6c80;">PetStay Booking Confirmed</h2>
        <p><strong>Owner:</strong> {owner_name}</p>
        <p><strong>Booking ID:</strong> {booking_id}</p>
        <p>Click this link to check-in: <a href="{qr_link}">{qr_link}</a></p>
        <p>Or scan the QR code below:</p>
        <p><img src="{qr_url}" width="200" height="200" alt="QR Code" /></p>
        <p style="color: #888;">— PetStay Team</p>
      </body>
    </html>
    """

    try:
        response = ses.send_email(
            Source='petstayteam@gmail.com',
            Destination={"ToAddresses": ["petstayteam@outlook.com"]},
            Message={
                "Subject": {"Data": f"PetStay Booking Confirmed - {owner_name}"},
                "Body": {
                    "Text": {"Data": f"Owner: {owner_name}\nBooking ID: {booking_id}\nCheck-in link: {qr_link}"},
                    "Html": {"Data": body_html}
                }
            }
        )
        bookings_table.update_item(
            Key={'BookingID': booking_id},
            UpdateExpression='SET EmailStatus = :status, EmailSentAt = :time',
            ExpressionAttributeValues={
                ':status': 'Success',
                ':time': datetime.utcnow().isoformat()
            }
        )
        return "Email sent to PetStay team"

    except Exception as e:
        bookings_table.update_item(
            Key={'BookingID': booking_id},
            UpdateExpression='SET EmailStatus = :status, EmailSentAt = :time',
            ExpressionAttributeValues={
                ':status': f'Failed: {str(e)}',
                ':time': datetime.utcnow().isoformat()
            }
        )
        return f"Email failed: {str(e)}"


def get_single_booking(booking_id):
    try:
        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking:
            return {'statusCode': 404, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking not found'})}

        if 'QRCodeKey' in booking:
            booking['QRCodeURL'] = generate_presigned_url(booking['QRCodeKey'])

        return {'statusCode': 200, 'headers': HEADERS, 'body': json.dumps(booking)}
    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'error': str(e)})}



def get_all_bookings():
    try:
        response = bookings_table.scan()
        bookings = response.get('Items', [])
        for b in bookings:
            if 'QRCodeKey' in b:
                b['QRCodeURL'] = generate_presigned_url(b['QRCodeKey'])
        bookings.sort(key=lambda x: x.get("CheckInDate", ""), reverse=True)
        return {'statusCode': 200, 'headers': HEADERS, 'body': json.dumps({'bookings': bookings})}
    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'error': str(e)})}



def get_room_availability():
    try:
        response = rooms_table.scan()
        rooms = response.get('Items', [])
        total = len(rooms)
        occupied = sum(1 for r in rooms if r.get('isOccupied') is True)
        available = total - occupied
        return {
            'statusCode': 200,
            'headers': HEADERS,
            'body': json.dumps({'stats': {
                'totalRooms': total,
                'occupiedRooms': occupied,
                'availableRooms': available,
                'rooms': rooms
            }})
        }
    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'error': str(e)})}

def confirm_booking(event, booking_id):
    try:
        if not is_admin(event):
            return {'statusCode': 403, 'headers': HEADERS, 'body': json.dumps({'message': 'Unauthorized'})}

        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking or booking.get('Status') != 'Pending':
            return {'statusCode': 400, 'headers': HEADERS, 'body': json.dumps({'message': 'Invalid booking status'})}

        qr_url_text = f"https://master.d3lmxb04veurt7.amplifyapp.com/checkin.html?bookingId={booking_id}"
        img = qrcode.make(qr_url_text)
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)
        qr_data = buffer.read()

        # Upload QR and get key
        qr_key = upload_qr_to_s3(qr_data)

        # Update booking with status and QR key
        bookings_table.update_item(
            Key={'BookingID': booking_id},
            UpdateExpression='SET #s = :status, QRCodeKey = :qrkey',
            ExpressionAttributeNames={'#s': 'Status'},
            ExpressionAttributeValues={
                ':status': 'Confirmed',
                ':qrkey': qr_key
            }
        )

        # Generate pre-signed URL for email
        qr_url = generate_presigned_url(qr_key)

        # Emit EventBridge event
        eventbridge.put_events(
            Entries=[
                {
                    'Source': 'PetStay.Booking',
                    'DetailType': 'BookingConfirmed',
                    'Detail': json.dumps({
                        'BookingID': booking_id,
                        'OwnerName': booking['OwnerName'],
                        'Status': 'Confirmed'
                    }),
                    'EventBusName': 'PetStayBus'
                }
            ]
        )

        # Send email with pre-signed URL
        email_result = send_confirmation_email(booking['OwnerName'], booking_id, qr_url)

        return {
            'statusCode': 200,
            'headers': HEADERS,
            'body': json.dumps({'message': f'Booking confirmed and email sent. {email_result}'})
        }

    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'error': str(e)})}



def cancel_booking(event, booking_id):
    try:
        if not is_admin(event):
            return {'statusCode': 403, 'headers': HEADERS, 'body': json.dumps({'message': 'Unauthorized: Only admin can cancel'})}

        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking:
            return {'statusCode': 404, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking not found'})}

        transact_items = [{
            'Update': {
                'TableName': 'Bookings',
                'Key': {'BookingID': {'S': booking_id}},
                'UpdateExpression': 'SET #s = :cancelled',
                'ExpressionAttributeNames': {'#s': 'Status'},
                'ExpressionAttributeValues': {':cancelled': {'S': 'Cancelled'}}
            }
        }]

        room_id = booking.get('RoomNumber')
        if room_id:
            transact_items.append({
                'Update': {
                    'TableName': 'Rooms',
                    'Key': {'roomId': {'S': room_id}},
                    'UpdateExpression': 'SET isOccupied = :false',
                    'ExpressionAttributeValues': {':false': {'BOOL': False}}
                }
            })

        dynamodb_client.transact_write_items(TransactItems=transact_items)

        # Emit event to EventBridge
        eventbridge.put_events(
            Entries=[
                {
                    'Source': 'PetStay.Booking',
                    'DetailType': 'BookingCancelled',
                    'Detail': json.dumps({'BookingID': booking_id}),
                    'EventBusName': 'PetStayBus'
                }
            ]
        )

        return {
            'statusCode': 200,
            'headers': HEADERS,
            'body': json.dumps({'message': 'Booking cancelled'})
        }

    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'error': str(e)})}


def restore_booking(event, booking_id):
    try:
        if not is_admin(event):
            return {'statusCode': 403, 'headers': HEADERS, 'body': json.dumps({'message': 'Unauthorized: Only admin can restore'})}

        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking:
            return {'statusCode': 404, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking not found'})}
        if booking.get('Status') != 'Cancelled':
            return {'statusCode': 400, 'headers': HEADERS, 'body': json.dumps({'message': 'Only cancelled bookings can be restored'})}

        bookings_table.update_item(
            Key={'BookingID': booking_id},
            UpdateExpression='SET #s = :status',
            ExpressionAttributeNames={'#s': 'Status'},
            ExpressionAttributeValues={':status': 'Pending'}
        )

        # Emit event to EventBridge
        eventbridge.put_events(
            Entries=[
                {
                    'Source': 'PetStay.Booking',
                    'DetailType': 'BookingRestored',
                    'Detail': json.dumps({'BookingID': booking_id}),
                    'EventBusName': 'PetStayBus'
                }
            ]
        )

        return {'statusCode': 200, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking restored'})}
    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'error': str(e)})}


def checkout_booking(event, booking_id):
    try:
        if not is_admin(event):
            return {'statusCode': 403, 'headers': HEADERS, 'body': json.dumps({'message': 'Unauthorized: Only admin can check out'})}

        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking:
            return {'statusCode': 404, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking not found'})}
        if booking.get('Status') != 'Checked-In':
            return {'statusCode': 400, 'headers': HEADERS, 'body': json.dumps({'message': 'Only checked-in bookings can be checked out'})}

        if booking.get('RoomNumber'):
            rooms_table.update_item(
                Key={'roomId': booking['RoomNumber']},
                UpdateExpression='SET isOccupied = :false',
                ExpressionAttributeValues={':false': False}
            )

        bookings_table.update_item(
            Key={'BookingID': booking_id},
            UpdateExpression='SET #s = :status, CheckOutTime = :time',
            ExpressionAttributeNames={'#s': 'Status'},
            ExpressionAttributeValues={
                ':status': 'Checked-Out',
                ':time': datetime.utcnow().isoformat()
            }
        )

        # Emit event to EventBridge
        eventbridge.put_events(
            Entries=[
                {
                    'Source': 'PetStay.Booking',
                    'DetailType': 'BookingCheckedOut',
                    'Detail': json.dumps({'BookingID': booking_id}),
                    'EventBusName': 'PetStayBus'
                }
            ]
        )

        return {'statusCode': 200, 'headers': HEADERS, 'body': json.dumps({'message': 'Guest checked out'})}
    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'error': str(e)})}


def checkin_booking(event, booking_id):
    try:
        email = extract_email_from_token(event)

        if not email:
            return {
                'statusCode': 401,
                'headers': HEADERS,
                'body': json.dumps({'message': 'Missing or invalid token'})
            }

        if email not in allowed_staff:
            return {
                'statusCode': 403,
                'headers': HEADERS,
                'body': json.dumps({'message': 'Unauthorized email'})
            }

        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking:
            return {
                'statusCode': 404,
                'headers': HEADERS,
                'body': json.dumps({'message': 'Booking not found'})
            }

        if booking.get('Status') == 'Checked-In':
            return {
                'statusCode': 200,
                'headers': HEADERS,
                'body': json.dumps({'message': 'Already checked in', 'roomId': booking.get('RoomNumber')})
            }

        if booking.get('Status') == 'Checked-Out':
            return {
                'statusCode': 400,
                'headers': HEADERS,
                'body': json.dumps({'message': 'Guest has already checked out. Check-in not allowed.'})
            }

        if booking.get('Status') != 'Confirmed':
            return {
                'statusCode': 400,
                'headers': HEADERS,
                'body': json.dumps({'message': 'Booking must be confirmed before check-in'})
             }

        pet_type = booking.get('PetSpecies', '')
        if pet_type not in ['Dog', 'Cat']:
            return {
                'statusCode': 400,
                'headers': HEADERS,
                'body': json.dumps({'message': 'Unsupported pet type'})
            }

        available_rooms = rooms_table.scan(
            FilterExpression=Attr('petType').eq(pet_type) & Attr('isOccupied').eq(False)
        )

        if not available_rooms['Items']:
            return {
                'statusCode': 409,
                'headers': HEADERS,
                'body': json.dumps({'message': f'No available room for {pet_type}'})
            }

        room = available_rooms['Items'][0]
        room_id = room['roomId']
        checkin_time = datetime.utcnow().isoformat()
        checkin_date = datetime.utcnow().date().isoformat()

        dynamodb_client.transact_write_items(
            TransactItems=[
                {
                    'Update': {
                        'TableName': 'Rooms',
                        'Key': {'roomId': {'S': room_id}},
                        'UpdateExpression': 'SET isOccupied = :occupied',
                        'ConditionExpression': 'isOccupied = :false',
                        'ExpressionAttributeValues': {
                            ':occupied': {'BOOL': True},
                            ':false': {'BOOL': False}
                        }
                    }
                },
                {
                    'Update': {
                        'TableName': 'Bookings',
                        'Key': {'BookingID': {'S': booking_id}},
                        'UpdateExpression': 'SET #s = :status, CheckInTime = :time, CheckInDate = :date, RoomNumber = :room',
                        'ExpressionAttributeNames': {'#s': 'Status'},
                        'ExpressionAttributeValues': {
                            ':status': {'S': 'Checked-In'},
                            ':time': {'S': checkin_time},
                            ':date': {'S': checkin_date},
                            ':room': {'S': room_id}
                        }
                    }
                }
            ]
        )

        # Emit event to EventBridge
        eventbridge.put_events(
            Entries=[
                {
                    'Source': 'PetStay.Booking',
                    'DetailType': 'BookingCheckedIn',
                    'Detail': json.dumps({'BookingID': booking_id}),
                    'EventBusName': 'PetStayBus'
                }
            ]
        )

        return {
            'statusCode': 200,
            'headers': HEADERS,
            'body': json.dumps({
                'message': f'Checked-in to room {room_id}',
                'roomId': room_id,
                'newStatus': 'Checked-In'
            })
        }

    except dynamodb_client.exceptions.TransactionCanceledException as e:
        return {
            'statusCode': 409,
            'headers': HEADERS,
            'body': json.dumps({'error': 'Check-in failed. Room might already be occupied.', 'details': str(e)})
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': HEADERS,
            'body': json.dumps({'error': str(e)})
        }
