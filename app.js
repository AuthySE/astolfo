var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var request = require('request');
var logger = require('winston');

var app = express();

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
//app.use(logger('dev'));
//app.use(bodyParser.json());
app.use(bodyParser.text());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

//Get Environment Variables
var config = require('./config.js');

//Set Logger Information
logger.add(logger.transports.File, { filename: config.log_filename });
logger.level = config.log_level;

logger.debug("TWILIO_ACCOUNT_SID: " + process.env.TWILIO_ACCOUNT_SID)
logger.debug("TWILIO_AUTH_TOKEN: " + process.env.TWILIO_AUTH_TOKEN)
logger.debug("AUTHY_API_KEY: " + process.env.AUTHY_API_KEY)
logger.debug("TWILIO_PHONE_SID:" + process.env.TWILIO_PHONE_SID)
logger.debug("-------------------------------------------");

const twilio = require('twilio')(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
const enums = require('authy-client').enums;
const Client = require('authy-client').Client;
const authy = new Client({key: config.AUTHY_API_KEY});

var phone_number = null;
var country_code = null;
var authy_id = null;
var phone_sid = null;
var reuse_number = false;
var reporting = [
	{'product':'Phone Verification','status':false,'description':'Phone Verification Tests Not Executed'},
	{'product':'OneCode','status':false,'description':'OneCode Tests Not Executed'}
];

//Receive OneCode SMS Content to be validated
app.post('/onecode', function (req, res) {
  logger.info("Received message: " + req.body.Body);
  var token = req.body.Body.match(/\d/g);
  token = token.join("");
  oneCodeVerify(token);
  res.send('Success!');
})

//Receive Phone Verification SMS Content to be validated
app.post('/verification', function (req, res) {
  logger.info("Received message: " + req.body.Body);
  var token = req.body.Body.match(/\d/g);
  token = token.join("");
  phoneVerificationVerify(token);
  res.send('Success!');
})

//Start the test framework via API
app.post('/start', function (req, res) {
	logger.info("Received request to start testing framework...");
  	tryPhoneVerification();
  	res.send('Success!');
})

/* API Home Page */
app.get('/', function (req, res) {
	res.render('index',{ title : 'Authy OneCode and Phone Verification Automated Testing Framework' })
});

//Get a Twilio Number and set the SMS Webhook - Get the Phone_Number
function tryPhoneVerification(){
	if(config.phone_verification == true){
		logger.info("Running Phone Verification Testing");
		if (config.useExistingNumber == true){
			logger.info("Updating Existing Number to Phone Verification Webhook");
			twilio.incomingPhoneNumbers(process.env.TWILIO_PHONE_SID).update({
				SmsUrl: config.pv_sms_url,
				SmsMethod: 'POST',
				FriendlyName: 'PhoneVerificationTestingNumber'
			}, function(err, number){
				if(err == null){
					country_code = number.phone_number.substring(0,2);
					phone_number = number.phone_number.substring(2,12);
					phone_sid = number.sid;
					logger.info("Country Code: " + country_code + " and Phone Number: " + phone_number);
					logger.debug("Phone SID: " + phone_sid);
					logger.info("Updated existing number to send callback to: " + number.sms_url);
					if(config.onecode == true){
						reuse_number = true;	
					}
					//Call Authy Phone Verification 
					phoneVerificationRequest(country_code, phone_number);
				}else{
					logger.error("ERROR: " + err.message);
				}				
			});
		}else{
			twilio.incomingPhoneNumbers.create({
			SmsUrl: config.pv_sms_url,
			AreaCode: config.area_code,
			FriendlyName: 'PhoneVerificationTestingNumber'
		}, function(err, number){
			if (err == null){
				logger.info("New Twilio Number Registered is: " + number.phone_number);
				country_code = number.phone_number.substring(0,2);
				phone_number = number.phone_number.substring(2,12);
				phone_sid = number.sid;
				logger.info("Country Code: " + country_code + " and Phone Number: " + phone_number);
				logger.debug("Phone SID: " + phone_sid);
				logger.info("Twilio Phone Number has been set to send callback to: " + number.sms_url);
				if(config.onecode == true){
					reuse_number = true;	
				}
				//Call Authy Phone Verification 
				phoneVerificationRequest(country_code, phone_number);
			}else{
				logger.error("ERROR: " + err.message);
			}	
		});
		}	
	}else{
		tryOneCode();
	}
}

function tryOneCode(){
	if(config.onecode == true){
		logger.info("Running Authy OneCode Testing");
		if(reuse_number == false && config.useExistingNumber == false){
			logger.info("Getting a New Twilio Number");
			twilio.incomingPhoneNumbers.create({
			SmsUrl: config.oc_sms_url,
			AreaCode: config.area_code,
			FriendlyName: 'OneCodeTestingNumber'
		}, function(err, number){
				if (err == null){
					logger.info("New Twilio Number Registered is: " + number.phone_number);
					country_code = number.phone_number.substring(0,2);
					phone_number = number.phone_number.substring(2,12);
					phone_sid = number.sid;
					logger.info("Country Code: " + country_code + " and Phone Number: " + phone_number);
					logger.debug("Phone SID: " + phone_sid);
					//Call Authy User Registration
					registerUser(country_code, phone_number);
				}else{
					logger.error("ERROR: " + err.message);
				}
			});
		}else{
			logger.info("Reusing Existing Twilio Number");	
			logger.info("Updating Existing Number to OneCode Webhook");
			twilio.incomingPhoneNumbers(process.env.TWILIO_PHONE_SID).update({
				SmsUrl: config.oc_sms_url,
				FriendlyName: 'OneCodeTestingNumber'
			}, function(err, number){
				if(err == null){
					country_code = number.phone_number.substring(0,2);
					phone_number = number.phone_number.substring(2,12);
					phone_sid = number.sid;
					logger.info("Country Code: " + country_code + " and Phone Number: " + phone_number);
					logger.debug("Phone SID: " + phone_sid);
					logger.info("Updated existing number to send callback to: " + number.sms_url);
					//Call Authy User Registration
					registerUser(country_code, phone_number);
				} else{
					logger.error("ERROR: " + err.message);
				}
			});
		}
	}
}
 
 //Remove Twilio Number
 function removeTwilioNumber(){
 	if(reuse_number == false && config.useExistingNumber == false){
	 	twilio.incomingPhoneNumbers(phone_sid).delete(function(err){
	 		if (err) throw err;
	 		logger.info("Twilio Phone Number Released");
	 	});
 	}
}

 //Register the user with Authy - Get the Authy_ID
 function registerUser(country_code, phone_number){
 	reuse_number = false;
 	authy.registerUser({
 		countryCode: 'US',
		email: 'test@test.com',
		phone: phone_number
	}, function (err, registration) {
		if (err) throw err;
		authy_id = registration.user.id;
		logger.info("Authy User Registered: " + authy_id);
		//Call Authy OneCode API
		oneCodeRequest(authy_id);
	});	
 }
 
 //Remove Authy User
 function removeUser(){
 	authy.deleteUser({ authyId: authy_id }, function(err, res) {
 		if (err) throw err;
 		logger.info('User has been scheduled for deletion');
 	});
 }

//Trigger OneCode Request
function oneCodeRequest(authyID){
	authy.requestSms({ authyId: authyID }, function(err, res) {
  		if (err) throw err;
  		logger.info('Message sent successfully to', phone_number);
  		if (config.polling == true){
				pollTwilioNumber(false);
  		}
	});
}

//Validate OneCode Request
function oneCodeVerify(token){
	logger.info("Validating token: " + token + " for Authy ID: " + authy_id);
	authy.verifyToken({ authyId: authy_id, token: token }, function(err, res) {
		if (err){
			logger.info("Token: " + res.token);
			console.log(JSON.stringify(reporting));
		}else{
			logger.info("Token: " + res.token);
			reporting[1].status = true;
			reporting[1].description = 'OneCode Tests Executed Successfully';
			console.log(JSON.stringify(reporting));
		}
	});
	// removeUser(authy_id);
	if(config.remove_number == true){
		removeTwilioNumber();	
	}
}

//Trigger Phone Verification
function phoneVerificationRequest(country_code, phone_number){
	logger.info("Starting Phone Verification for: " + phone_number);
	var options = {
		url: 'https://api.authy.com/protected/json/phones/verification/start',
		method: 'POST',
		form: {'api_key':config.AUTHY_API_KEY,'country_code':country_code,'phone_number':phone_number,'via':'sms'}
	}
	request(options, function(error, response, body){
		if(!error && response.statusCode == 200){
			logger.debug("Phone Information: " + body);
			if (config.polling == true){
				pollTwilioNumber(true);
  			}
		}else{
			logger.error("ERROR: " + error);
		}
	})	
}

//Validate Phone Verification Request
function phoneVerificationVerify(token){
	authy.verifyPhone({ 
		countryCode: 'US', 
		phone: phone_number, 
		token: token }, function(err, res) {
			if (err){
				logger.info(res.success);
				console.log(JSON.stringify(reporting));
			}else{
				logger.info(res.message);
				reporting[0].status = true;
				reporting[0].description = 'Phone Verification Tests Executed Successfully';
				if(config.onecode == false){
					console.log(JSON.stringify(reporting));	
				}
			}
		});
	if(config.remove_number == true){
		removeTwilioNumber();	
	}
	tryOneCode();
}

//Poll Twilio Number for New SMS Messages
function pollTwilioNumber(verify){
	logger.info("Polling Twilio Number for new SMS messages");
	setTimeout(function () {
		twilio.messages.list(function(err, data) {
			if(err){
				logger.error(err.message)
			}else{
				_msg = data.messages[0].body;
				console.log("Got message: " + _msg);
				var token = _msg.match(/\d/g);
				token = token.join("");
				if(verify == true){
					phoneVerificationVerify(token);
				}else{
					oneCodeVerify(token);
				}
			}			
		});
	}, 3000);
	
}

//Start Testing Framework Automatically
if(config.runOnStartup == true){
	tryPhoneVerification();	
}


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
