const fs = require('fs');
const Transform = require('stream').Transform;
const formidable = require('formidable');
var sha256 = require('sha256');

//connect DynamoDB
var config = require('./config.js');
var AWS = require('aws-sdk');
AWS.config.update(config.aws_remote_config);
const s3 = new AWS.S3();

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
            console.log(fields);

            if (userType == "Student" || userType == "Professor") {
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
                            }
                        },
                        ConditionExpression: 'attribute_not_exists(userId)',
                        ReturnValues: 'NONE'
                    };
        
                    resolve(params);
                })
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
                await deleteFile(originalData['resumeBucketKey'].S).then(async function() {
                    resumeFile = files.resumeInput[0]._writeStream.path;
                    await uploadFile(resumeFile, makeid(8)).then(value => {
                        fieldsToUpdate["resumeBucketKey"] = value;
                        resolve(fieldsToUpdate);
                    })
                });
            } else {
                resolve(fieldsToUpdate);
            }
        })
    })
}

module.exports = {
    parsefile: parsefile,
    updatefile: updatefile
};