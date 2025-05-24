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
dynamodb_client = boto3.client('dynamodb')
bookings_table = dynamodb.Table('Bookings')
rooms_table = dynamodb.Table('Rooms')

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
                    return {'statusCode': 400, 'body': json.dumps({'message': f'Missing field: {field}'})}

            booking_id = str(uuid.uuid4())
            created_at = datetime.datetime.utcnow().isoformat()

            item = {
                "BookingID": booking_id,
                "OwnerName": body["OwnerName"],
                "Email": body["Email"],
                "PhoneNumber": body["PhoneNumber"],
                "PetName": body["PetName"],
                "PetSpecies": body.get("PetSpecies", ""),
                "PetBreed": body.get("PetBreed", ""),
                "PetAge": str(body.get("PetAge", "")),
                "CheckInDate": body["CheckInDate"],
                "CheckOutDate": body["CheckOutDate"],
                "ArrivalTime": body.get("ArrivalTime", ""),
                "Status": "Pending",
                "RoomNumber": "",
                "CreatedAt": created_at
            }

            bookings_table.put_item(Item=item)

            qr_text = f"https://master.d3lmxb04veurt7.amplifyapp.com/checkin.html?bookingId={booking_id}"
            img = qrcode.make(qr_text)
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            qr_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json'},
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
                return {'statusCode': 404, 'body': json.dumps({'message': 'Booking not found'})}
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps(item)
            }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': 'Internal server error',
                'error': str(e)
            })
        }
