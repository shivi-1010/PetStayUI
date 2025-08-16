#  Event-Driven Serverless Pet Stay Booking Management System

## Overview
This project is an event‑driven serverless application that manages a Pet Stay booking system on AWS. It uses fully managed services to ensure scalability, high availability and reduced operational overhead. The system allows users to interact through a chatbot and website, while backend logic is orchestrated through serverless functions and event‑based processing.


## Architecture
The application follows a three‑tier architecture consisting of web, application and database tiers. The web tier uses AWS Amplify to host the static website connected to a GitHub repository, automatically deploying changes on commit. The application tier includes Amazon API Gateway as the front door to backend APIs, AWS Lambda for business logic and AWS Step Functions to orchestrate the booking workflow. Amazon EventBridge publishes booking events to decouple components. Cognito User Pool secures admin logins and provides JWT tokens, while the Identity Pool grants temporary credentials for unauthenticated chatbot access. The database tier stores data in Amazon DynamoDB for high performance and scalability.


## Services Used
- **AWS Amplify** – Hosts the static website and triggers automatic deployments from GitHub.
- **Amazon Cognito** – User Pool provides authentication and JWT token generation. Identity Pool grants temporary credentials for the chatbot.
- **Amazon Lex V2** – Handles chatbot interactions and booking flow inputs.
- **Amazon API Gateway** – Serves as the secure front door to backend APIs.
- **AWS Lambda** – Executes backend logic in stateless serverless functions.
- **AWS Step Functions** – Orchestrates the step-by-step booking process and handles retries.
- **Amazon EventBridge** – Publishes booking events to allow loosely‑coupled integrations.
- **Amazon DynamoDB** – Stores booking data with high availability.


## Deployment Instructions
1. Clone the GitHub repository containing the frontend code.
2. Connect the repository to AWS Amplify and enable automatic builds and deployments.
3. Configure Amazon Cognito User Pool and Identity Pool in the AWS Console.
4. Deploy the API using Amazon API Gateway and link it to Lambda functions.
5. Upload the Lex V2 chatbot intents and connect them to Lambda via Identity Pool.
6. Create the Step Functions workflow to orchestrate bookings and configure EventBridge rules.
7. Create DynamoDB tables for storing booking information.


## Usage
Users access the static website hosted by Amplify and interact with the chatbot powered by Lex V2. The chatbot collects booking details and invokes Lambda functions via API Gateway. Step Functions manages the booking flow while EventBridge emits events for other services to react. Booking information is stored in DynamoDB and users receive confirmation.

**Login Credentials**

- **Admin Username:** petstayteam@outlook.com  
  **Password:** PetStay@987654321

- **Staff Username:** petstayteam@gmail.com  
  **Password:** PetStay@987654321

Users access the static website hosted by Amplify and interact with the chatbot powered by Lex V2. The chatbot collects booking details and invokes Lambda functions via API Gateway. Step Functions manages the booking flow while EventBridge emits events for other services to react. Booking information is stored in DynamoDB and users receive confirmation.


## Conclusion
By leveraging managed AWS services, this serverless and event‑driven architecture eliminates server maintenance and provides automatic scalability, security and disaster recovery. The system demonstrates an efficient and modern approach to building cloud applications.
