#CreateBookingFunction

import json
import boto3
import uuid
import datetime
import qrcode
import base64
from io import BytesIO
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
bookings_table = dynamodb.Table('Bookings')

HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
}


def lambda_handler(event, context):
    print("Full Event:", json.dumps(event))

    http_method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method')
    path = event.get('path') or event.get('requestContext', {}).get('http', {}).get('path', '')
    path_params = event.get('pathParameters') or {}
    booking_id = path_params.get('bookingId')

    print("HTTP Method:", http_method)
    print("Path:", path)
    print("Path Params:", path_params)

    try:
        # 1. Create a new booking
        if http_method == 'POST' and path.lower().endswith('/newbooking'):
            body = json.loads(event['body'])

            required_fields = ['OwnerName', 'Email', 'PhoneNumber', 'PetName', 'CheckInDate', 'CheckOutDate']
            for field in required_fields:
                if field not in body:
                    return {
                        'statusCode': 400,
                        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                        'body': json.dumps({'message': f'Missing field: {field}'})
                    }

            try:
                datetime.datetime.strptime(body["CheckInDate"], "%Y-%m-%d")
                datetime.datetime.strptime(body["CheckOutDate"], "%Y-%m-%d")
            except ValueError:
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'message': 'Invalid date format. Use YYYY-MM-DD.'})
                }

            booking_id = str(uuid.uuid4())
            created_at = datetime.datetime.utcnow().isoformat()

            # Generate QR
            qr_text = f"https://master.d3lmxb04veurt7.amplifyapp.com/checkin.html?bookingId={booking_id}"
            img = qrcode.make(qr_text)
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            qr_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

            item = {
                "BookingID": booking_id,
                "OwnerName": body["OwnerName"],
                "Email": body["Email"],
                "PhoneNumber": body["PhoneNumber"],
                "PetName": body["PetName"],
                "PetSpecies": body.get("PetSpecies", ""),
                "PetBreed": body.get("PetBreed", ""),
                "PetAge": str(body["PetAge"]) if "PetAge" in body else "",
                "CheckInDate": body["CheckInDate"],
                "CheckOutDate": body["CheckOutDate"],
                "ArrivalTime": body.get("ArrivalTime", ""),
                "Status": "Pending",
                "RoomNumber": "",
                "CreatedAt": created_at,
                "QRBase64": qr_base64
            }

            bookings_table.put_item(Item=item)

            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({
                    'message': 'Booking created successfully!',
                    'BookingID': booking_id,
                    'qrCode': qr_base64,
                    'qrLink': qr_text
                })
            }

        # 2. Fetch booking details
        elif http_method == 'GET' and booking_id:
            response = bookings_table.get_item(Key={'BookingID': booking_id})
            item = response.get('Item')
            if not item:
                return {
                    'statusCode': 404,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'message': 'Booking not found'})
                }

            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps(item)
            }

           # 3. Staff Check-In
        elif http_method == 'POST' and path.lower().endswith('/checkin') and booking_id:
            claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
            email = claims.get("email", "").lower()

            allowed_staff = ["petstayteam@outlook.com"]
            if email not in [e.lower() for e in allowed_staff]:
                return {
                    'statusCode': 403,
                    'headers': HEADERS,
                    'body': json.dumps({'message': 'Unauthorized: Staff access only'})
                }

            # Fetch booking
            response = bookings_table.get_item(Key={'BookingID': booking_id})
            booking = response.get("Item")
            if not booking:
                return {
                    'statusCode': 404,
                    'headers': HEADERS,
                    'body': json.dumps({'message': 'Booking not found'})
                }

            status = booking.get("Status")
            if status != "Confirmed":
                return {
                    'statusCode': 400,
                    'headers': HEADERS,
                    'body': json.dumps({'message': f"Cannot check-in. Current status: '{status}' (must be 'Confirmed')."})
                }

            species = booking.get("PetSpecies", "Dog")
            room_id = f"{species}-Room-{uuid.uuid4().hex[:6]}"
            checkin_time = datetime.datetime.utcnow().isoformat()

            try:
                # Update booking in DynamoDB
                bookings_table.update_item(
                    Key={'BookingID': booking_id},
                    UpdateExpression="SET #s = :s, RoomNumber = :r, CheckInTime = :t",
                    ExpressionAttributeNames={'#s': 'Status'},
                    ExpressionAttributeValues={
                        ':s': 'Checked-In',
                        ':r': room_id,
                        ':t': checkin_time
                    }
                )

                # Re-fetch to confirm
                updated = bookings_table.get_item(Key={'BookingID': booking_id}).get("Item")
                print("✅ Booking updated:", updated)

                return {
                    'statusCode': 200,
                    'headers': HEADERS,
                    'body': json.dumps({
                        'message': f"Guest checked in successfully to room {room_id}",
                        'roomId': room_id,
                        'checkInTime': checkin_time,
                        'newStatus': updated.get("Status")
                    })
                }

            except ClientError as e:
                print("❌ DynamoDB update failed:", str(e))
                return {
                    'statusCode': 500,
                    'headers': HEADERS,
                    'body': json.dumps({'message': 'Failed to check-in guest', 'error': str(e)})
                }
    except Exception as e:
        print("❌ General error:", str(e))
        return {
            'statusCode': 500,
            'headers': HEADERS,
            'body': json.dumps({'error': str(e)})
        }
