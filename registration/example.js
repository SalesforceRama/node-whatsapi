var whatsapi = require('../whatsapi');
var crypto = require('crypto');
var read = require('read'); //"npm install read" before use

var config = {
  msisdn: "", //fill it with your phone
  device_id: crypto.randomBytes(20).toString('hex')
};

var WhatsApiRegistration = whatsapi.createRegistration(config);

WhatsApiRegistration.codeRequest('sms', function(err, res) {
  if (err) throw err;
  console.log(res);
  read({prompt: 'Code: '}, function (err, code) {
    if (err) throw err;
    code = code.replace(/[^0-9]/,'');
    WhatsApiRegistration.codeRegister(code, function(err, res) {
      if (err) throw err;
      console.log(res);
    });
  });
});
