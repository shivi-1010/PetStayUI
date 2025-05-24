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

        # 3. Check-in with transactional room allocation
        elif http_method == 'POST' and '/checkin' in path and booking_id:
            booking_response = bookings_table.get_item(Key={'BookingID': booking_id})
            booking = booking_response.get('Item')

            if not booking:
                return {'statusCode': 404, 'body': json.dumps({'message': 'Booking not found'})}

            if booking.get('Status') == 'Checked-In':
                return {
                    'statusCode': 200,
                    'body': json.dumps({'message': 'Already checked in', 'roomId': booking.get('RoomNumber')})
                }

            pet_type = booking.get('PetSpecies', '')
            if pet_type not in ['Dog', 'Cat']:
                return {'statusCode': 400, 'body': json.dumps({'message': 'Unsupported pet type'})}

            # Find available room for the pet type
            available_rooms = rooms_table.scan(
                FilterExpression=Attr('petType').eq(pet_type) & Attr('isOccupied').eq(False)
            )

            if not available_rooms['Items']:
                return {
                    'statusCode': 409,
                    'body': json.dumps({'message': f'No available room for {pet_type}'})
                }

            room = available_rooms['Items'][0]
            room_id = room['roomId']
            checkin_time = datetime.datetime.utcnow().isoformat()

            try:
                # Atomic transaction: update both room and booking
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
                                'UpdateExpression': 'SET #s = :status, CheckInTime = :time, RoomNumber = :room',
                                'ExpressionAttributeNames': {'#s': 'Status'},
                                'ExpressionAttributeValues': {
                                    ':status': {'S': 'Checked-In'},
                                    ':time': {'S': checkin_time},
                                    ':room': {'S': room_id}
                                }
                            }
                        }
                    ]
                )

                return {
                    'statusCode': 200,
                    'body': json.dumps({
                        'message': f'Booking checked-in and assigned to {room_id}',
                        'roomId': room_id
                    })
                }

            except ClientError as e:
                return {
                    'statusCode': 500,
                    'body': json.dumps({'message': 'Check-in failed', 'error': str(e)})
                }

        # 4. Unsupported route
        else:
            return {'statusCode': 400, 'body': json.dumps({'message': 'Unsupported operation or missing parameters'})}

    except Exception as e:
        return {'statusCode': 500, 'body': json.dumps({'message': str(e)})}
