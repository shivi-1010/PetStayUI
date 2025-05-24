import json
import boto3
from datetime import datetime
from boto3.dynamodb.conditions import Attr

# Initialize DynamoDB
dynamodb = boto3.resource('dynamodb')
dynamodb_client = boto3.client('dynamodb')
bookings_table = dynamodb.Table('Bookings')
rooms_table = dynamodb.Table('Rooms')

# Global CORS headers
HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
}

def lambda_handler(event, context):
    method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method')
    path = event.get('path') or event.get('requestContext', {}).get('http', {}).get('path', '')
    print("HTTP Method:", method)
    print("Path:", path)

    try:
        # GET /bookings
        if method == 'GET' and path == '/bookings':
            return get_all_bookings()

        # GET /rooms/availability
        elif method == 'GET' and path == '/rooms/availability':
            return get_room_availability()

        # POST /booking/{bookingId}/cancel
        elif method == 'POST' and path.startswith('/booking/') and path.endswith('/cancel'):
            booking_id = path.split('/')[2]
            return cancel_booking(booking_id)

        # POST /booking/{bookingId}/checkout
        elif method == 'POST' and path.startswith('/booking/') and path.endswith('/checkout'):
            booking_id = path.split('/')[2]
            return checkout_booking(booking_id)

        # POST /booking/{bookingId}/confirm
        elif method == 'POST' and path.startswith('/booking/') and path.endswith('/confirm'):
            booking_id = path.split('/')[2]
            return confirm_booking(booking_id)

        # POST /booking/{bookingId}/checkin
        elif method == 'POST' and path.startswith('/booking/') and path.endswith('/checkin'):
            booking_id = path.split('/')[2]
            return checkin_booking(booking_id)

        else:
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

def get_all_bookings():
    try:
        response = bookings_table.scan()
        bookings = response.get('Items', [])
        bookings.sort(key=lambda x: x.get("CheckInDate", ""), reverse=True)
        return {
            'statusCode': 200,
            'headers': HEADERS,
            'body': json.dumps(bookings)
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': HEADERS,
            'body': json.dumps({'error': str(e)})
        }

def get_room_availability():
    try:
        response = rooms_table.scan()
        rooms = response.get('Items', [])
        total = len(rooms)
        occupied = sum(1 for r in rooms if r.get('isOccupied') == True)
        available = total - occupied
        return {
            'statusCode': 200,
            'headers': HEADERS,
            'body': json.dumps({
                'totalRooms': total,
                'occupiedRooms': occupied,
                'availableRooms': available
            })
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': HEADERS,
            'body': json.dumps({'error': str(e)})
        }

def cancel_booking(booking_id):
    try:
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
                    'Key': {'RoomNumber': {'S': room_id}},
                    'UpdateExpression': 'SET isOccupied = :false',
                    'ExpressionAttributeValues': {':false': {'BOOL': False}}
                }
            })

        dynamodb_client.transact_write_items(TransactItems=transact_items)
        return {'statusCode': 200, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking cancelled and room freed (if assigned)'})}

    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'error': str(e)})}

def checkout_booking(booking_id):
    try:
        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking:
            return {'statusCode': 404, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking not found'})}

        if booking.get('Status') != 'Checked-In':
            return {'statusCode': 400, 'headers': HEADERS, 'body': json.dumps({'message': 'Only checked-in bookings can be checked out'})}

        if booking.get('RoomNumber'):
            rooms_table.update_item(
                Key={'RoomNumber': booking['RoomNumber']},
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

        return {'statusCode': 200, 'headers': HEADERS, 'body': json.dumps({'message': 'Pet checked out and room released'})}

    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'error': str(e)})}

def confirm_booking(booking_id):
    try:
        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking:
            return {'statusCode': 404, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking not found'})}

        if booking.get('Status') != 'Pending':
            return {'statusCode': 400, 'headers': HEADERS, 'body': json.dumps({'message': 'Only pending bookings can be confirmed'})}

        bookings_table.update_item(
            Key={'BookingID': booking_id},
            UpdateExpression='SET #s = :confirmed',
            ExpressionAttributeNames={'#s': 'Status'},
            ExpressionAttributeValues={':confirmed': 'Confirmed'}
        )

        return {'statusCode': 200, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking confirmed'})}

    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'error': str(e)})}

def checkin_booking(booking_id):
    try:
        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking:
            return {'statusCode': 404, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking not found'})}

        if booking.get('Status') == 'Checked-In':
            return {'statusCode': 200, 'headers': HEADERS, 'body': json.dumps({'message': 'Already checked in', 'roomId': booking.get('RoomNumber')})}

        if booking.get('Status') != 'Confirmed':
            return {'statusCode': 400, 'headers': HEADERS, 'body': json.dumps({'message': 'Booking must be confirmed before check-in'})}

        pet_type = booking.get('PetSpecies', '')
        if pet_type not in ['Dog', 'Cat']:
            return {'statusCode': 400, 'headers': HEADERS, 'body': json.dumps({'message': 'Unsupported pet type'})}

        available_rooms = rooms_table.scan(
            FilterExpression=Attr('petType').eq(pet_type) & Attr('isOccupied').eq(False)
        )

        if not available_rooms['Items']:
            return {'statusCode': 409, 'headers': HEADERS, 'body': json.dumps({'message': f'No available room for {pet_type}'})}

        room = available_rooms['Items'][0]
        room_id = room['roomId']
        checkin_time = datetime.utcnow().isoformat()

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

        return {'statusCode': 200, 'headers': HEADERS, 'body': json.dumps({'message': f'Booking checked-in and assigned to {room_id}', 'roomId': room_id})}

    except Exception as e:
        return {'statusCode': 500, 'headers': HEADERS, 'body': json.dumps({'message': 'Check-in failed', 'error': str(e)})}
