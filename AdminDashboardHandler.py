import json
import boto3
from datetime import datetime

# Initialize DynamoDB tables
dynamodb = boto3.resource('dynamodb')
bookings_table = dynamodb.Table('Bookings')
rooms_table = dynamodb.Table('Rooms')

# Global CORS headers
HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
}

def lambda_handler(event, context):
    method = event.get('httpMethod')
    path = event.get('path')

    # Route: GET /bookings
    if method == 'GET' and path == '/bookings':
        return get_all_bookings()

    # Route: GET /rooms/availability
    elif method == 'GET' and path == '/rooms/availability':
        return get_room_availability()

    # Route: POST /booking/{bookingId}/cancel
    elif method == 'POST' and path.startswith('/booking/') and path.endswith('/cancel'):
        booking_id = path.split('/')[2]
        return cancel_booking(booking_id)

    # Route: POST /booking/{bookingId}/checkout
    elif method == 'POST' and path.startswith('/booking/') and path.endswith('/checkout'):
        booking_id = path.split('/')[2]
        return checkout_booking(booking_id)

    # Fallback
    return {
        'statusCode': 404,
        'headers': HEADERS,
        'body': json.dumps({'message': 'Route not found'})
    }

# ─────────────────────────────
# GET /bookings
# ─────────────────────────────
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

# ─────────────────────────────
# GET /rooms/availability
# ─────────────────────────────
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

# ─────────────────────────────
# POST /booking/{bookingId}/cancel
# ─────────────────────────────
def cancel_booking(booking_id):
    try:
        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking:
            return {
                'statusCode': 404,
                'headers': HEADERS,
                'body': json.dumps({'message': 'Booking not found'})
            }

        if booking.get('Status') == 'Checked-In' and booking.get('RoomNumber'):
            rooms_table.update_item(
                Key={'roomId': booking['RoomNumber']},
                UpdateExpression='SET isOccupied = :false',
                ExpressionAttributeValues={':false': False}
            )

        bookings_table.update_item(
            Key={'BookingID': booking_id},
            UpdateExpression='SET #s = :status',
            ExpressionAttributeNames={'#s': 'Status'},
            ExpressionAttributeValues={':status': 'Cancelled'}
        )

        return {
            'statusCode': 200,
            'headers': HEADERS,
            'body': json.dumps({'message': 'Booking cancelled successfully'})
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'headers': HEADERS,
            'body': json.dumps({'error': str(e)})
        }

# ─────────────────────────────
# POST /booking/{bookingId}/checkout
# ─────────────────────────────
def checkout_booking(booking_id):
    try:
        booking = bookings_table.get_item(Key={'BookingID': booking_id}).get('Item')
        if not booking:
            return {
                'statusCode': 404,
                'headers': HEADERS,
                'body': json.dumps({'message': 'Booking not found'})
            }

        if booking.get('Status') != 'Checked-In':
            return {
                'statusCode': 400,
                'headers': HEADERS,
                'body': json.dumps({'message': 'Only checked-in bookings can be checked out'})
            }

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

        return {
            'statusCode': 200,
            'headers': HEADERS,
            'body': json.dumps({'message': 'Pet checked out and room released'})
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'headers': HEADERS,
            'body': json.dumps({'error': str(e)})
        }
