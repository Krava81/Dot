const https = require('https');
https.get('https://ais-pre-rmq2x3cl372oyaqjtvr24s-648683748313.europe-west2.run.app/api/status', (res) => {
  console.log('Status Code:', res.statusCode);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Body:', data.substring(0, 200)));
});
