window.PETSTAY_CONFIG = {
  AWS_REGION: 'us-east-1',
  COGNITO_USER_POOL_ID: 'us-east-1_I0PzIIZGM',
  COGNITO_USER_POOL_CLIENT_ID: '4jfnrkopa8cb7r30i0i25gar8k',
  COGNITO_DOMAIN: 'us-east-1i0pziizgm.auth.us-east-1.amazoncognito.com',

  REDIRECT_SIGN_IN_URL: 'https://master.d3lmxb04veurt7.amplifyapp.com/admin-frontend/post-login.html',
  REDIRECT_ADMIN_SIGN_IN_URL: 'https://master.d3lmxb04veurt7.amplifyapp.com/admin-frontend/post-login.html',
  REDIRECT_SIGN_OUT_URL: 'https://master.d3lmxb04veurt7.amplifyapp.com/index.html',

  API_BASE_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/',
  BOOKING_API_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/booking',
  BOOKING_STATUS_API_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/bookingStatus',
  BOOKINGS_API_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/bookings',
  ROOMS_AVAILABILITY_API_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/rooms/availability',
  NEW_BOOKING_API_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/newbooking',
  CONFIRM_BOOKING_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/confirm',
  CANCEL_BOOKING_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/cancel',
  CHECKIN_BOOKING_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/checkin',
  CHECKOUT_BOOKING_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/checkout',
  RESTORE_BOOKING_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/restore',
  PET_PHOTO_UPLOAD_URL: 'https://howm2f0jc9.execute-api.us-east-1.amazonaws.com/upload-url',
  PET_PHOTO_PUBLIC_URL_BASE: 'https://petstay-pet-photos-101481565.s3.amazonaws.com',

IOT_ENDPOINT: 'a14wno4fkns9pt-ats.iot.us-east-1.amazonaws.com', 
  IOT_TOPIC_DASHBOARD: 'petstay/admin/stats',  
  IOT_CLIENT_PREFIX: 'admin-dashboard-',                       
  IDENTITY_POOL_ID: 'us-east-1:25fbdcc1-9e3d-4655-adbf-679d2f895c0c',

  // Chatbot (Amazon Lex V2)
  LEX: {
    REGION: 'us-east-1',
    IDENTITY_POOL_ID: 'us-east-1:c7a2fc1a-defe-44f2-a081-15894b4ff215',
    BOT_ID: 'S1HI9REYR4',
    BOT_ALIAS_ID: 'RI03IXGQ8Q',
    LOCALE_ID: 'en_US',
    BOT_ALIAS_NAME : 'prod',
    BOT_NAME : 'PetStayChatBot',
  }
};

for (const key in window.PETSTAY_CONFIG) {
  const val = window.PETSTAY_CONFIG[key];
  if (typeof val === 'string' && (val.includes('{{') || val.includes('}}'))) {
    throw new Error(`Missing config value: ${key}. Did you forget to set environment variables?`);
  }
}


