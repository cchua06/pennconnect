var sha256 = require('sha256');
const fileparser = require('./fileparser.js');
const NodeCache = require('node-cache');
const cache = new NodeCache();

//connect DynamoDB
var config = require('./config.js');
var AWS = require('aws-sdk');
AWS.config.update(config.aws_remote_config);
var db = new AWS.DynamoDB();
var s3 = new AWS.S3();
const axios = require('axios')
const flaskServer = "http://127.0.0.1:5000/";

var loadAnnouncementScores = async function(posts, userAlgorithm) {    
    const apiURL = flaskServer + "get_score";
    const headers = {'Content-Type': 'application/json'};
    return new Promise((resolve, reject) => {
        let data = {};
        var count = 0;

        for (var i = 0; i < posts.length; i++) {
            const postParams = JSON.stringify({
                announcement_id: posts[i].announcementId.S,
                algorithm_id: userAlgorithm
            });
            axios.post(apiURL, postParams, { headers })
            .then(response => {
                var announcementId = JSON.parse(response.config.data).announcement_id;
                data[announcementId] = response.data.score
                if (count == posts.length - 1) {
                    resolve(data);
                }
                count++;
            })
            .catch(error => {
                reject(error);
            });
        }
    })
}

var postAnnouncementFlask = async function(postData) {
    const apiURL = flaskServer + "log_announcement";
    const headers = {'Content-Type': 'application/json'};
    return new Promise((resolve, reject) => {
        const postParams = JSON.stringify({
            userCreated: postData.userCreated,
            text: postData.content,
            announcementTitle: postData.title
        });
        axios.post(apiURL, postParams, {headers})
        .then(response => {
            resolve(response);
        })
        .catch(error => {
            reject(error);
        })
    })
}

var postAnnouncement = async function(req, res) {
    const currUser = req.session.userId;
    const postData = {};
    postData["userCreated"] = currUser;
    postData["content"] = req.body.content;
    postData["title"] = req.body.title;
    await postAnnouncementFlask(postData).then(value => {
        cache.del(currUser);
        res.send(true);
    });
}

function parseCustomDate(dateString) {
    // Parse the custom date format 'DD/MM/YYYY, HH:mmA'
    const parts = dateString.match(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+)([APMapm]+)/);
    const day = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10) - 1; // Months are zero-based in JavaScript
    const year = parseInt(parts[3], 10);
    let hours = parseInt(parts[4], 10);
    const minutes = parseInt(parts[5], 10);
    const meridiem = parts[6].toUpperCase();

    if (meridiem === 'PM' && hours < 12) {
        hours += 12;
    } else if (meridiem === 'AM' && hours === 12) {
        hours = 0;
    }

    return new Date(year, month, day, hours, minutes);
}

var getAnnouncements = async function(user) {
    return new Promise((resolve, reject) => {
        const params = {
            TableName: 'announcements',
        };

        const cachedAnnouncements = cache.get(user);

        if (cachedAnnouncements) {
            resolve(cachedAnnouncements);
        } else {
            db.scan(params, async function(err, data) {
                var posts = data.Items;
                if (err) {
                    reject(err);
                } else {
                    const params1 = {
                        TableName: 'users',
                        Key: {
                            "userId": {S: user}
                        }
                    }
        
                    db.getItem(params1, async function(err, algoData) {
                        if (err) {
                            console.log(err);
                            reject(err);
                        } else {
                            var userAlgorithm = algoData.Item.algorithmId.S;
        
                            await loadAnnouncementScores(posts, userAlgorithm).then(value => {
                                for (var i = 0; i < posts.length; i++) {
                                    var announcementId = posts[i].announcementId.S;
                                    posts[i].announcementId = announcementId;
                                    posts[i].announcementDateTime = posts[i].announcementDateTime.S;
                                    posts[i].contents = posts[i].contents.S;
                                    posts[i].announcementTitle = posts[i].announcementTitle.S;
                                    posts[i].userCreated = posts[i].userCreated.S;
                                    posts[i].score = value[announcementId];
                                    posts[i].tags = posts[i].tags.S;
                                }
    
                                const sortedAnnouncements = posts.sort((a, b) => {
                                    const scoreComparison = b.score - a.score;
                                    if (scoreComparison === 0) {
                                        const dateA = parseCustomDate(a.announcementDateTime);
                                        const dateB = parseCustomDate(b.announcementDateTime);
                                        return dateB - dateA;
                                    }                   
                                    return scoreComparison;
                                });
                                cache.set(user, sortedAnnouncements);
                                resolve(sortedAnnouncements);
                            })
                        }
                    })
                }
            });
        }
    })
}

var retrieveAnnouncementData = async function (announcementId) {
    return new Promise((resolve, reject) => {
        const params = {
            TableName: 'announcements',
            Key: {
                "announcementId": {S: announcementId}
            }
        }

        db.getItem(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        })
    });
}

var getAnnouncement = async function(req, res) {
    if (!req.session.userId) {
        return res.redirect('/loginPage');
    } else {
        await retrieveAnnouncementData(req.query.id).then(value => {
            return res.render('announcementPage.ejs', {data: value.Item});
        })
    }
}

var homePage = async function(req, res) {
    if (!req.session.userId) {
        return res.redirect("/loginPage");
    } else {
        await getAnnouncements(req.session.userId).then(value => {
            return res.render('home.ejs', {userId: req.session.userId, posts: value});
        })
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
        data.Item['verified'] = {"S": "F"};

        db.putItem(data, function(err, data) {
            if (err) { //username already exists
                if (err.code === 'ConditionalCheckFailedException') {
                    res.redirect('/registerPage?err=1');
                } else {
                    console.error('Error:', err);
                }
            } else {
                res.render('verifyAccount.ejs');
                //req.session.userId = userId;
                //res.redirect('/home');
            }
        });        
    }).catch(error => {
        console.log(error);
    });
}

var verifyAccount = async function(req, res) {

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
            return res.redirect('/profile');
        }
        let friendValue = 0;
        await isFriend(currentUser, friendId).then(async function(alreadyFriend) {
            if (alreadyFriend !== 'false') {
                friendValue = alreadyFriend;
            }
            await isFriendRequest(currentUser, friendId).then(async function(alreadyRequest) {
                if (alreadyRequest) {
                    friendValue = 2;
                }
                await isRequested(currentUser, friendId).then(async function(requested) {
                    if (requested) {
                        friendValue = 1;
                    }
                    await getProfile(friendId).then(async function(value) {
                        const userType = value.userType.S;
                        if (userType == "Student" || userType == "Professor") {
                            if (value.resumeBucketKey.S != '') {
                                await updateResumeLink(value.resumeBucketKey.S).then(resumeURL => {
                                    return res.render('profilePage.ejs', {userId: value.userId.S, data: value, resume: resumeURL, orgWebsite: null, friend: friendValue});
                                });
                            }  else {
                                return res.render('profilePage.ejs', {userId: value.userId.S, data: value, resume: null, orgWebsite: null, friend: friendValue});
                            }
                        } else {
                            return res.render('profilePage.ejs', {userId: value.userId.S, data: value, resume: null, orgWebsite: value.orgWebsite.S, friend: friendValue});
                        }
                    })
                })
            })
        })
    }
}

var connectionsPage = async function(req, res) {
    if (!req.session.userId) {
        return res.redirect("/loginPage");
    } else {
        await getFriends(req, res).then(async function(friends) {
            await getRequests(req, res).then(async function(requests) {
                return res.render('connections.ejs', {userId: req.session.userId, friends: friends, requests: requests});
            });
        });
    }
}

//connections routes
var getFriends = async function(req, res) {
    return new Promise((resolve, reject) => {
        var params = {
            TableName: "connections",
            ProjectionExpression: "userB",
            FilterExpression: "userA = :userId",
            ExpressionAttributeValues: {
                ":userId": { S: req.session.userId }
            }
        }
    
        db.scan(params, function(err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data.Items);
            }
        })
    })
}

var getRequests = async function(req, res) {
    return new Promise((resolve, reject) => {
        var params = {
            TableName: "requests",
            ProjectionExpression: "userA",
            FilterExpression: "userB = :userId",
            ExpressionAttributeValues: {
                ":userId": { S: req.session.userId }
            }
        }
    
        db.scan(params, function(err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data.Items);
            }
        })
    })
}

var isFriend = async function(currUser, friend) {
    return new Promise((resolve, reject) => {
        params = {
            TableName: "connections",
            Key: {
                "uniqueId": {
                    "S": currUser + "|%|" + friend
                }
            }
        }

        db.getItem(params, function(err, data) {
            if (data == null) {
                resolve('false');
            } else if (Object.keys(data).length === 0) {
                resolve('false');
            } else {
                var friendSince = data.Item.friendSince.S;
                const inputDate = new Date(friendSince);
                const options = { year: 'numeric', month: 'long', day: 'numeric' };
                const formattedDate = inputDate.toLocaleDateString('en-US', options);
                resolve(formattedDate);
            }
        })
    })
}

var isFriendRequest = async function(currUser, friend) {
    return new Promise((resolve, reject) => {
        params = {
            TableName: "requests",
            Key: {
                "uniqueId": {
                    "S": currUser + "|%|" + friend
                }
            }
        }

        db.getItem(params, function(err, data) {
            if (data == null) {
                resolve(false);
            } else if (Object.keys(data).length === 0) {
                resolve(false);
            } else {
                resolve(true);
            }
        })
    })
}

var isRequested = async function(currUser, friend) {
    return new Promise((resolve, reject) => {
        params = {
            TableName: "requests",
            Key: {
                "uniqueId": {
                    "S": friend + "|%|" + currUser
                }
            }
        }

        db.getItem(params, function(err, data) {
            if (data == null) {
                resolve(false);
            } else if (Object.keys(data).length === 0) {
                resolve(false);
            } else {
                resolve(true);
            }
        })
    })
}

var sendFriendRequest = function(req, res) {
    const currentUser = req.body.currentUser;
    const friendToAdd = req.body.friendToAdd;
    const currentDate = new Date();
    const formattedDate = currentDate.toISOString().slice(0, 16).replace("T", " ");
    const params = {
        TableName: 'requests',
        Item: {
            "uniqueId": {
                "S": currentUser + "|%|" + friendToAdd
            },
            "userA": {
                "S": currentUser
            },
            "userB": {
                "S": friendToAdd
            },
            "requestSince": {
                "S": formattedDate
            }
        }
    }

    db.putItem(params, function(err, data) {
        if (err) {
            return err;
        } else {
            return res.redirect('/otherProfile?friendId=' + friendToAdd);
        }
    })
}

var deleteFriendRequest = async function(req, res) {
    const currUser = req.session.userId;
    const friend = req.body.friendToDel;
    const params = {
        TableName: 'requests',
        Key: {
            'uniqueId': {S: friend + "|%|" + currUser},
        },
    };

    db.deleteItem(params, async function(err, data) {
        if (err) {
            res.send(err);
        } else {
            res.send(data);
        }
    })
}

var deleteFriendRequestSelf = async function(req, res) {
    const currUser = req.session.userId;
    const friend = req.body.friendToDel;
    const params = {
        TableName: 'requests',
        Key: {
            'uniqueId': {S: currUser + "|%|" + friend},
        },
    };

    db.deleteItem(params, async function(err, data) {
        if (err) {
            res.send(err);
        } else {
            res.send(data);
        }
    })
}

var deleteFriendRequestNoAjax = async function(req, res) {
    return new Promise((resolve, reject) => {
        const currUser = req.session.userId;
        const friend = req.body.friendToDel;
        const params = {
            TableName: 'requests',
            Key: {
              'uniqueId': {S: friend + "|%|" + currUser},
            },
        };

        db.deleteItem(params, async function(err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        })
    });
}

var addFriend = async function(req, res) {
    const currentUser = req.session.userId;
    const friendToAdd = req.body.friendToAdd;
    await deleteFriendRequestNoAjax(req, res).then(async function(value) {
        const currentDate = new Date();
        const formattedDate = currentDate.toISOString().slice(0, 16).replace("T", " ");
        const params = {
            TableName: 'connections',
            Item: {
                "uniqueId": {
                    "S": currentUser + "|%|" + friendToAdd
                },
                "userA": {
                    "S": currentUser
                },
                "userB": {
                    "S": friendToAdd
                },
                "friendSince": {
                    "S": formattedDate
                }
            }
        };

        db.putItem(params, function(err, data) {
            if (err) { //already a friend
                res.send(err);
            } else {
                const params1 = {
                    TableName: 'connections',
                    Item: {
                        "uniqueId": {
                            "S": friendToAdd + "|%|" + currentUser
                        },
                        "userA": {
                            "S": friendToAdd
                        },
                        "userB": {
                            "S": currentUser
                        },
                        "friendSince": {
                            "S": formattedDate
                        }
                    }
                };

                db.putItem(params1, function(err1, data1) {
                    if (err1) { 
                        res.send(err1);
                    } else {
                        res.send(data1);
                    }
                });
            }
        });
    });
};

var deleteFriend = async function(req, res) {
    const currUser = req.session.userId;
    const friendToDel = req.body.friendToDel;
    const params = {
        TableName: 'connections',
        Key: {
          'uniqueId': {S: friendToDel + "|%|" + currUser},
        },
    };

    db.deleteItem(params, function(err, data) {
        if (err) {
            reject(err);
        } else {
            const params = {
                TableName: 'connections',
                Key: {
                  'uniqueId': {S: currUser + "|%|" + friendToDel},
                },
            };
    
            db.deleteItem(params, async function(err, data) {
                if (err) {
                    res.send(err);
                } else {
                    res.send(data);
                }
            })
        }
    })
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
        const signedUrl = s3.getSignedUrl('getObject', params);
        resolve(signedUrl);
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
        cache.del(user);
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
    cache.del(req.session.userId);
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
    send_friend_request: sendFriendRequest,
    delete_friend_request: deleteFriendRequest,
    delete_friend_request_self: deleteFriendRequestSelf,
    add_friend: addFriend,
    delete_friend: deleteFriend,
    connections_page: connectionsPage,
    create_account: createAccount,
    get_profile: getProfile,
    verify_account: verifyAccount,
    update_profile: updateProfile,
    get_announcements: getAnnouncements,
    get_announcement: getAnnouncement,
    post_announcement: postAnnouncement,
    log_out: logOut
}

module.exports = view_routes;