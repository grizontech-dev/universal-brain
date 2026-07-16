const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://grizon_user:grizon_password_123@localhost:5432/grizon_db' });
client.connect().then(() => {
  client.query('UPDATE users SET password_hash = $1 WHERE email = $2', [
    '$argon2id$v=19$m=65536,t=3,p=4$vCMBBlfW+osH4Q8+YvOMDg$a+SsecFr9vrig3GUfFapC2tdSQMS7WtMax5kffyohjA',
    'arsh0deep0kaur0@gmail.com'
  ]).then(res => {
    console.log(res.rowCount + ' row updated');
    client.end();
  });
});
