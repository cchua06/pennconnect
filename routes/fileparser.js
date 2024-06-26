const fs = require('fs');
const Transform = require('stream').Transform;
const formidable = require('formidable');
var sha256 = require('sha256');
const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');

//connect DynamoDB
var config = require('./config.js');
var AWS = require('aws-sdk');
AWS.config.update(config.aws_remote_config);
var db = new AWS.DynamoDB();
const s3 = new AWS.S3();
const axios = require('axios');
const { send } = require('process');

async function generateAlgorithm(interestString) {
    return new Promise((resolve, reject) => {
        const apiURL = 'http://127.0.0.1:5000/create_algorithm'; // Use IPv4 loopback address
        const data = JSON.stringify({ goal: interestString });
        const headers = { 'Content-Type': 'application/json' };

        axios.post(apiURL, data, { headers })
        .then(response => {
            resolve(response.data);
        })
        .catch(error => {
            reject(error.message);
        });
    });
}

async function deleteAlgorithm(id) {
    return new Promise((resolve, reject) => {
        const params = {
            TableName: 'algorithms',
            Key: {
              'algorithmId': {S: id},
            },
        };

        db.deleteItem(params, function(err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data.Item);
            }
        })
    });
}

function makeid(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
      counter += 1;
    }
    return result;
}

async function uploadFile(file, id) {
    return new Promise((resolve, reject) => {
        if (file == null) {
            resolve();
        } else {
            const uploadParams = {
                Bucket: 'pennconnectresumes',
                Key: id,
                Body: fs.createReadStream(file)
            };
    
            s3.upload(uploadParams, (err, data) => {
                if (err) {
                  console.error('Error uploading file to S3:', err);
                  reject(err);
                } else {
                  console.log('File uploaded successfully to S3:', data.Key);
                  resolve(data.Key);
                }
            });
        }
    })
}

async function deleteFile(id) {
    return new Promise((resolve, reject) => {
        const deleteParams = {
            Bucket: 'pennconnectresumes',
            Key: id
        }
    
        s3.deleteObject(deleteParams, (err, data) => {
            if (err) {
                console.log('Error deleting file from S3: ', err);
                reject(err);
            } else {
                console.log("File deleted successfully from S3: ", id);
                resolve(id);
            }
        });
    })
}

var sendEmailVerification = async function(userEmail) {
    return new Promise((resolve, reject) => {
        sgMail.setApiKey(config.SENDGRID_API_KEY);
        const token = crypto.randomBytes(64).toString('hex');
        const url = 'http://localhost:8080/verify?token=' + token;
        const msg = {
            to: userEmail, // Change to your recipient
            from: 'pennconnect34@gmail.com', // Change to your verified sender
            subject: 'Verify your PennConnect Account',
            text: 'Hello,\nClick on this link to verify your email: ' + url,
            html: 'Hello,\nClick on this link to verify your email: ' + url,
        };
        sgMail
        .send(msg)
        .then(() => {
            console.log("sent mail to " + userEmail);
            resolve("Verification mail sent");
        })
        .catch((error) => {
            reject(error);
        })
    })
}

const parsefile = async (req, res) => {
    console.log("Starting file parsing");
    return new Promise((resolve, reject) => {
        const form = new formidable.IncomingForm();
        form.allowEmptyFiles = true;
        form.keepExtensions = true;
        
        form.parse(req, async function (err, fields, files) {
            var firstName = fields.firstname[0];
            var lastName = fields.lastname[0];
            var email = fields.email[0];
            var userId = fields.username[0];
            var hashed_password = sha256(fields.password[0]);
            var userType = fields.userType[0];
            var resumeFile = "";
            var orgWebsite = "";
            var orgDescription = "";
            var interests = "I am interested in everything.";
            if (fields.interests != null) {
                var interestString = fields.interests[0];
                var interestsArray = interestString.split(',');
                interestsArray.pop();

                interests = interestsArray.map(function(interest) {
                    return 'I am interested in ' + interest.trim() + '.';
                }).join(' ');
            }

            await sendEmailVerification(email).then(async function() {
                await generateAlgorithm(interests).then(async function(algorithmId) {
                    var algorithmString = algorithmId.algorithmId;
                    if (userType == "Student" || userType == "Professor") {
                        if (files.resume == null) {
                            var params = {
                                TableName: "users",
                                Item: {
                                    "userId": {
                                        "S": userId
                                    },
                                    "firstName": {
                                        "S": firstName
                                    },
                                    "lastName": {
                                        "S": lastName
                                    },
                                    "email": {
                                        "S": email
                                    },
                                    "password": {
                                        "S": hashed_password
                                    },
                                    "userType": {
                                        "S": userType
                                    },
                                    "resumeBucketKey": {
                                        "S": resumeFile
                                    },
                                    "orgWebsite": {
                                        "S": orgWebsite
                                    },
                                    "orgDescription": {
                                        "S": orgDescription
                                    },
                                    "interests": {
                                        "S": interests
                                    },
                                    "algorithmId": {
                                        "S": algorithmString
                                    }
                                },
                                ConditionExpression: 'attribute_not_exists(userId)',
                                ReturnValues: 'NONE'
                            };
                
                            resolve(params);
                        } else {
                            resumeFile = files.resume[0]._writeStream.path;
                            await uploadFile(resumeFile, makeid(8)).then(value => {
                                var params = {
                                    TableName: "users",
                                    Item: {
                                        "userId": {
                                            "S": userId
                                        },
                                        "firstName": {
                                            "S": firstName
                                        },
                                        "lastName": {
                                            "S": lastName
                                        },
                                        "email": {
                                            "S": email
                                        },
                                        "password": {
                                            "S": hashed_password
                                        },
                                        "userType": {
                                            "S": userType
                                        },
                                        "resumeBucketKey": {
                                            "S": value
                                        },
                                        "orgWebsite": {
                                            "S": orgWebsite
                                        },
                                        "orgDescription": {
                                            "S": orgDescription
                                        },
                                        "interests": {
                                            "S": interests
                                        },
                                        "algorithmId": {
                                            "S": algorithmString
                                        }
                                    },
                                    ConditionExpression: 'attribute_not_exists(userId)',
                                    ReturnValues: 'NONE'
                                };
                    
                                resolve(params);
                            })
                        }
                    } else if (userType == "Organization") {
                        orgWebsite = fields.orgWebsite[0];
                        orgDescription = fields.orgDescription[0];
                        var params = {
                            TableName: "users",
                            Item: {
                                "userId": {
                                    "S": userId
                                },
                                "firstName": {
                                    "S": firstName
                                },
                                "lastName": {
                                    "S": lastName
                                },
                                "email": {
                                    "S": email
                                },
                                "password": {
                                    "S": hashed_password
                                },
                                "userType": {
                                    "S": userType
                                },
                                "resumeBucketKey": {
                                    "S": resumeFile
                                },
                                "orgWebsite": {
                                    "S": orgWebsite
                                },
                                "orgDescription": {
                                    "S": orgDescription
                                },
                                "interests": {
                                    "S": interests
                                },
                                "algorithmId": {
                                    "S": algorithmString
                                }
                            },
                            ConditionExpression: 'attribute_not_exists(userId)',
                            ReturnValues: 'NONE'
                        };
            
                        resolve(params);
                    } else {
                        reject(err);
                    }
                });
            })
        });
    })
}

const updatefile = async (req, originalData) => {
    return new Promise((resolve, reject) => {
        const form = new formidable.IncomingForm();
        form.allowEmptyFiles = true;
        form.keepExtensions = true;
        fieldsToUpdate = {};

        form.parse(req, async function (err, fields, files) {
            for (const field in fields) {
                let original = originalData[field].S;
                let updated = fields[field][0]
                if (original != updated) {
                    fieldsToUpdate[field] = updated;
                }
            }
            if (files && files.resumeInput) {
                resumeFile = files.resumeInput[0]._writeStream.path;
                try {
                    await deleteFile(originalData['resumeBucketKey'].S).then(async function() {
                        await uploadFile(resumeFile, makeid(8)).then(value => {
                            fieldsToUpdate["resumeBucketKey"] = value;
                            resolve(fieldsToUpdate);
                        });
                    });
                } catch (error) {
                    await uploadFile(resumeFile, makeid(8)).then(value => {
                        fieldsToUpdate["resumeBucketKey"] = value;
                        resolve(fieldsToUpdate);
                    });
                }
            } else {
                if (fieldsToUpdate.interests != null) {
                    var originalAlgorithm = originalData["algorithmId"].S;
                    var updatedInterest = fields.interests[0];
                    
                    await (deleteAlgorithm(originalAlgorithm).then(async function() {
                        console.log(updatedInterest);
                        await (generateAlgorithm(updatedInterest)).then(value => {
                            fieldsToUpdate.interests = updatedInterest;
                            fieldsToUpdate.algorithmId = value.algorithmId;
                            resolve(fieldsToUpdate);
                        });
                    }));
                } else {
                    resolve(fieldsToUpdate);
                }
            }
        })
    })
}

module.exports = {
    parsefile: parsefile,
    updatefile: updatefile
};