import json
import boto3

client = boto3.client('stepfunctions')

def lambda_handler(event, context):
    executionArn = event['pathParameters']['executionArn']

    response = client.describe_execution(
        executionArn=executionArn
    )

    output = {}
    if response['status'] == 'SUCCEEDED':
        raw_output = {}
        if 'output' in response:
            raw_output = json.loads(response['output'])
            if isinstance(raw_output, dict) and 'body' in raw_output:
                raw_output = json.loads(raw_output['body'])
        output = {
            'status': 'SUCCEEDED',
            'output': raw_output
        }
    else:
        output = { 'status': response['status'] }

    return {
        'statusCode': 200,
        'headers': { 'Access-Control-Allow-Origin': '*' },
        'body': json.dumps(output)
    }
