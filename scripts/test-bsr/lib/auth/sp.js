const axios = require('axios');

async function mintSpAccessToken(config) {
  const response = await axios.post(
    'https://api.amazon.com/auth/o2/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      timeout: 30000,
    },
  );

  if (!response.data?.access_token) {
    throw new Error('Amazon SP token minting succeeded without an access_token');
  }

  return response.data.access_token;
}

module.exports = {
  mintSpAccessToken,
};
