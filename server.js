const express = require('express');
const routes = require('./routes/routes.js');
let session = require('express-session');
const app = express();
app.use(express.urlencoded());
app.set('view engine', 'ejs');
app.use(session({
    secret: 'asdf',
    resave: false,
    saveUninitialized: true,
    cookie: {secure: false}
}));
app.use(express.static('public'));
const http = require('http').Server(app);

//view routes
app.get('/', routes.home_page);
app.get('/home', routes.home_page);
app.get('/loginPage', routes.login_page);
app.post('/checkLogin', routes.check_login);
app.get('/registerPage', routes.register_page);
app.get('/logOut', routes.log_out);

//profile routes
app.post('/createAccount', routes.create_account);
app.get('/profile', routes.profile_page);
app.get('/connections', routes.connections_page);
app.get('/otherProfile', routes.view_other);

//data routes
app.get('/profileData', routes.get_profile);
app.post('/updateProfile', routes.update_profile);

//announcement routes
app.get('/getAnnouncements', routes.get_announcements);

const fileparser = require('./routes/fileparser.js');

app.get('/testhere', (req, res) => {
    res.send(`
      <h2>File Upload With <code>"Node.js"</code></h2>
      <form action="/api/upload" enctype="multipart/form-data" method="post">
        <div>Select a file: 
          <input name="file" type="file" />
        </div>
        <input type="submit" value="Upload" />
      </form>
  
    `);
});

app.post('/api/upload', async (req, res) => {
  await fileparser(req)
  .then(data => {
    res.status(200).json({
      message: "Success",
      data
    })
  })
  .catch(error => {
    console.log(error);
  })
});


app.listen(8080, () => {
    console.log('Server running at http://localhost:8080')
})

module.exports = app;