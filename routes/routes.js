var sha256 = require('sha256');
const fileparser = require('./fileparser.js');

//connect DynamoDB
var config = require('./config.js');
var AWS = require('aws-sdk');
AWS.config.update(config.aws_remote_config);
var db = new AWS.DynamoDB();
var s3 = new AWS.S3();

var getAnnouncements = function(req, res) {
    let user = req.session.userId;
    let posts = [{
        announcementId: 1,
        announcementTitle: "CIS Colloquium",
        userCreated: "aiatpenn",
        contents: "Join us this Saturday at 10 am",
        announcementDate: "10/09/2023"
    }, {
        announcementId: 1,
        announcementTitle: "Basketball Pickup",
        userCreated: "cchua06",
        contents: "Join us this Sunday at 11:30 am at Pottruck",
        announcementDate: "11/11/2023"
    }]
    res.send(posts);
}

var homePage = async function(req, res) {
    if (!req.session.userId) {
        return res.redirect("/loginPage");
    } else {
        return res.render('home.ejs', {userId: req.session.userId});
    }
}

var loginPage = function(req, res) {
    if (req.query.err == 1) {
        res.render('login.ejs', {message: "No username entered"});
    } else if (req.query.err == 2) {
        res.render('login.ejs', {message: "No password entered"});
    } else if (req.query.err == 3) {
        res.render('login.ejs', {message: "Not a valid username"});
    } else if (req.query.err == 4) {
        res.render('login.ejs', {message: "Incorrect password"});
    } else {
        res.render('login.ejs', {message: null});
    }
}

var checkLogin = function(req, res) {
    var username = req.body.username;
    var password = req.body.password;
    if (!username) {
        return res.redirect('/loginPage?err=1');
    }
    if (!password) {
        return res.redirect('/loginPage?err=2');
    }
    var hashedPass = sha256(password);

    var params = {
        TableName: "users",
        AttributesToGet: ["password"],
        KeyConditions: {
            userId: {
                ComparisonOperator: 'EQ',
                AttributeValueList: [{S: username}]
            }
        }
    }

    db.query(params, function(err, data) {
        if (err || data.Items.length == 0) { //not valid username
            return res.redirect('/loginPage?err=3');
        } else {
            var correctPass = data.Items[0].password.S;
            if (!(hashedPass == correctPass)) { //not correct password
                return res.redirect('/loginPage?err=4');
            } else {
                req.session.userId = username;
                return res.redirect('/home');
            }
        }
    })
}

var registerPage = function(req, res) {
    if (req.query.err == 1) {
        return res.render('registerPage.ejs', {err: "Username already exists"});
    }
    return res.render('registerPage.ejs', {err: null});
}

var createAccount = async function(req, res) {
    await fileparser.parsefile(req).then(async data => {
        let userId = data.Item['userId'].S;

        db.putItem(data, function(err, data) {
            if (err) { //username already exists
                if (err.code === 'ConditionalCheckFailedException') {
                    res.redirect('/registerPage?err=1');
                } else {
                    console.error('Error:', err);
                }
            } else {
                req.session.userId = userId;
                res.redirect('/home');
            }
        });        
    }).catch(error => {
        console.log(error);
    });
}

//user pages
var profilePage = async function(req, res) {
    if (!req.session.userId) {
        return res.redirect("/loginPage");
    } else {
        await getProfile(req.session.userId).then(async function(value) {
            const userType = value.userType.S;
            if (userType == "Student" || userType == "Professor") {
                if (value.resumeBucketKey.S != '') {
                    await updateResumeLink(value.resumeBucketKey.S).then(resumeURL => {
                        return res.render('profilePage.ejs', {userId: value.userId.S, data: value, resume: resumeURL, orgWebsite: null});
                    });
                }  else {
                    return res.render('profilePage.ejs', {userId: value.userId.S, data: value, resume: null, orgWebsite: null});
                }
            } else {
                return res.render('profilePage.ejs', {userId: value.userId.S, data: value, resume: null, orgWebsite: value.orgWebsite.S});
            }
        });
    }
}

var viewOther = async function(req, res) {
    if (!req.session.userId) {
        return res.redirect("/loginPage");
    } else {
        let currentUser = req.session.userId;
        let friendId = req.query.friendId;
        if (currentUser == friendId) {
            profilePage(req, res);
            return;
        }
        await getProfile(friendId).then(async function(value) {
            const userType = value.userType.S;
            if (userType == "Student" || userType == "Professor") {
                await updateResumeLink(value.resumeBucketKey.S).then(resumeURL => {
                    return res.render('viewProfile.ejs', {userId: currentUser, viewId: friendId, data: value, resume: resumeURL, orgWebsite: null});
                });
            } else {
                return res.render('viewProfile.ejs', {userId: currentUser, viewId: friendId, data: value, resume: null, orgWebsite: value.orgWebsite.S});
            }
        })
    }
}

var connectionsPage = async function(req, res) {
    if (!req.session.userId) {
        return res.redirect("/loginPage");
    } else {
        return res.render('connections.ejs', {userId: req.session.userId});
    }
}

//get signed url of a bucket key
async function updateResumeLink(bucketKey) {
    return new Promise((resolve, reject) => {
        const bucketName = 'pennconnectresumes';
        const params = {
            Bucket: bucketName,
            Key: bucketKey,
            ResponseContentDisposition: `attachment; filename="${"resume.pdf"}"`
        }
        resolve(s3.getSignedUrl('getObject', params));
    })
}

var getProfile = async function(userId) {
    return new Promise((resolve, reject) => {
        var params = {
            TableName: 'users',
            Key: {
                "userId": {S: userId}
            }
        }
    
        db.getItem(params, function(err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data.Item);
            }
        })
    })
}

var updateProfile = async function(req, res) {
    let user = req.session.userId;
    console.log("Updating profile for user: ", user);

    await getProfile(user).then(async function(originalData) {
        await fileparser.updatefile(req, originalData).then(async data => {
            if (data && Object.keys(data).length > 0) {
                const params = {
                    TableName: 'users',
                    Key: {
                        "userId": {"S": user}
                    },
                    UpdateExpression: 'SET',
                    ExpressionAttributeValues: {}
                }  
                for (const key in data) {
                    if (data.hasOwnProperty(key)) {
                        params.UpdateExpression += ` #${key} = :${key},`;
                        params.ExpressionAttributeValues[`:${key}`] = {S: data[key]};
                        params.ExpressionAttributeNames = params.ExpressionAttributeNames || {};
                        params.ExpressionAttributeNames[`#${key}`] = key;
                    }
                }
                params.UpdateExpression = params.UpdateExpression.slice(0, -1);
                db.updateItem(params, (err, data) => {
                    if (err) {
                        console.log(err);
                    } else {
                        console.log("Updated user: ", user);
                        profilePage(req, res);
                    }
                })
            } else {
                profilePage(req, res);
            }
        }).catch(error => {
            console.log(error);
        });
    })

    //delete resume object if needed first
    //upload resume

    //upload fields
}

var logOut = function(req, res) {
    req.session.destroy();
    res.redirect('/loginPage');
}

var view_routes = {
    home_page: homePage,
    login_page: loginPage,
    check_login: checkLogin,
    register_page: registerPage,
    profile_page: profilePage,
    view_other: viewOther,
    connections_page: connectionsPage,
    create_account: createAccount,
    get_profile: getProfile,
    update_profile: updateProfile,
    get_announcements: getAnnouncements,
    log_out: logOut
}

module.exports = view_routes;