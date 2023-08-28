require("dotenv").config();
const express = require('express');
const ejs = require('ejs');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const session = require("express-session");
const passport = require('passport');
const passportLocalMongoose = require('passport-local-mongoose');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const findOrCreate = require('mongoose-findorcreate');
const FacebookStrategy = require('passport-facebook').Strategy;
var MicrosoftStrategy = require('passport-microsoft').Strategy;
const extractAudio = require('ffmpeg-extract-audio')
// const ffmpeg = require('fluent-ffmpeg');
const download = require('download');
const multer = require('multer');
// const { MongoClient } = require('mongodb');
// const ffmpeg = require('fluent-ffmpeg');
const { Readable } = require('stream');
const { MongoClient, GridFSBucket, ObjectId, Timestamp, Double } = require('mongodb');
const fs = require('fs');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
// const SpeechToTextV1 = require('watson-developer-cloud/speech-to-text/v1');
// const DeepSpeech = require('deepspeech');
// const { Pocketsphinx } = require('pocketsphinx');
const Creatomate = require('creatomate');
const transcribe = require('./transcribe');
const generateSubtitles = require('./generateSubtitles');

const client = new Creatomate.Client(process.env.CREATOMATE_API_KEY);

const app = express();

// Set up the storage engine for multer 
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(session({
  secret: "Our little secret.",
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

mongoose.connect("mongodb+srv://admin-chaitanya:Test123@cluster0.upazi.mongodb.net/audify?retryWrites=true&w=majority");

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  googleId: String,
  facebookId: String,
  microsoftId: String
});
const audioSchema = new mongoose.Schema({
  date: Date,
  duration: mongoose.Types.Decimal128,
  username: String,
  videoname: String,
  audioname: String,
  video: Buffer,
  audio: Buffer
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);
audioSchema.plugin(passportLocalMongoose);
audioSchema.plugin(findOrCreate);

const User = new mongoose.model("User", userSchema);
const Audio = new mongoose.model("Audio", audioSchema);

passport.use(User.createStrategy());
passport.use(Audio.createStrategy());

passport.serializeUser(function (user, done) {
  //user.id is not profile id. it is id that created by the database
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "http://localhost:3000/auth/google/secrets"
},
  function (accessToken, refreshToken, profile, cb) {
    console.log(profile);
    User.findOrCreate({
      username: profile.displayName,
      googleId: profile.id
    }, function (err, user) {
      return cb(err, user);
    });
  }
));

passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL: "http://localhost:3000/auth/facebook/secrets"
},
  function (accessToken, refreshToken, profile, cb) {
    console.log(profile);
    User.findOrCreate({
      username: profile.displayName,
      facebookId: profile.id
    }, function (err, user) {
      return cb(err, user);
    });
  }
));

passport.use(new MicrosoftStrategy({
  // Standard OAuth2 options
  clientID: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  callbackURL: "http://localhost:3000/auth/microsoft/secrets",
  scope: ['user.read'],

  // Microsoft specific options

  // [Optional] The tenant for the application. Defaults to 'common'.
  // Used to construct the authorizationURL and tokenURL
  tenant: 'common',

  // [Optional] The authorization URL. Defaults to `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`
  authorizationURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',

  // [Optional] The token URL. Defaults to `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
  tokenURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
},
  function (accessToken, refreshToken, profile, done) {
    console.log(profile);
    User.findOrCreate({
      username: profile.displayName,
      microsoftId: profile.id
    }, function (err, user) {
      return done(err, user);
    });
  }
));



app.get("/", function (req, res) {
  res.render("home");
});

app.get("/auth/google",
  passport.authenticate("google", {
    scope: ["profile"],
    prompt: 'select_account',
  })
);

app.get("/auth/google/secrets",
  passport.authenticate("google", {
    failureRedirect: "/login"
  }),
  function (req, res) {
    // Successful authentication, redirect to secrets.
    res.redirect("/secrets");
  });

app.get('/auth/facebook',
  passport.authenticate('facebook')
);

app.get('/auth/facebook/secrets',
  passport.authenticate('facebook', {
    failureRedirect: '/login'
  }),
  function (req, res) {
    // Successful authentication, redirect home.
    res.redirect('/secrets');
  });

app.get('/auth/microsoft',
  passport.authenticate('microsoft', {
    // Optionally define any authentication parameters here
    // For example, the ones in https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow

    prompt: 'select_account',
  }));

app.get('/auth/microsoft/secrets',
  passport.authenticate('microsoft', {
    failureRedirect: '/login'
  }),
  function (req, res) {
    // Successful authentication, redirect home.
    res.redirect('/secrets');
  });

app.get("/login", function (req, res) {
  res.render("login");
});
app.post("/login", function (req, res) {
  const user = new User({
    email: req.body.email,
    password: req.body.password
  });

  req.login(user, function (err) {
    if (err) {
      console.log(err);
    } else {
      passport.authenticate("local")(req, res, function () {
        res.redirect("/secrets");
      });
    }
  });
});

app.get("/register", function (req, res) {
  res.render("register");
});
app.post("/register", function (req, res) {
  User.register(({
    email: req.body.email
  }), req.body.password, function (err, user) {
    if (err) {
      console.log(err);
      res.redirect("/register");
    } else {
      passport.authenticate("local")(req, res, function () {
        res.redirect("/secrets");
      });
    }
  });
});

app.get("/history", function (req, res) {
  if (req.isAuthenticated()) {
    Audio.find({ username: req.user.username }, function (err, userAudios) {
      if (err) {
        console.log(err);
      } else {
        if (userAudios) {
          console.log("userAudios are found");
          // console.log(userAudios.videoname);
          // console.log(userAudios.audioname);
          res.render("history", {
            userAudios: userAudios,
            username: req.user.username
          });
        }
      }
    });
  } else {
    res.redirect("/login");
  }
});

app.post("/delete", async function (req, res) {
  const username = req.user.username;
  // const id = req.body.id;
  const videoname = req.body.videoname;
  const audioname = req.body.audioname;

  console.log(username);
  // console.log(id);
  console.log(videoname);
  console.log(audioname);

  // Example usage
  const uri = 'mongodb+srv://admin-chaitanya:Test123@cluster0.upazi.mongodb.net/audify?retryWrites=true&w=majority'; // MongoDB connection URI
  const dbName = 'audify'; // Name of your MongoDB database
  // Collection name where the video file is stored
  const collectionName = 'audios';

  const client = new MongoClient(uri);

  async function connect() {
    try {
      await client.connect();
      console.log('Connected to MongoDB');
    } catch (error) {
      console.error('Error connecting to MongoDB:', error);
    }
  }
  await connect();

  console.log("hello1")
  // Get the database reference
  const db = client.db(dbName);
  // Initialize GridFSBucket
  const bucket = new GridFSBucket(db);
  console.log("hello2")
  const collection = db.collection(collectionName);
  console.log("hello3")

  var myquery = { username: username, videoname: videoname, audioname: audioname };
  console.log("hello4")

  Audio.deleteOne(myquery, function (err, obj) {
    if (err) {
      console.log(err);
    } else {
      console.log("video and audio deleted");
      res.redirect("/history");
    }
  });
  console.log("HELLO");

});


app.get("/secrets", function (req, res) {
  if (req.isAuthenticated()) {
    console.log("user is authenticated");
  } else {
    res.redirect("/login");
  }
  res.render("secrets");
});

var audioFilename;
var audioFileData;


// upload.single('videofile')

app.post("/upload", upload.single('videofile'), async function (req, res) {

  if (req.isAuthenticated()) {
    console.log("user is authenticated");
  } else {
    res.redirect("/login");
  }

  const username = req.user.username;
  const filesize = req.file.size;
  const file = req.file.buffer;
  const fileName = req.file.originalname;
  // console.log(req.file.size)
  // Example usage
  const uri = 'mongodb+srv://admin-chaitanya:Test123@cluster0.upazi.mongodb.net/audify?retryWrites=true&w=majority'; // MongoDB connection URI
  const dbName = 'audify'; // Name of your MongoDB database
  // Collection name where the video file is stored
  const collectionName = 'audios';

  const client = new MongoClient(uri);

  async function connect() {
    try {
      await client.connect();
      console.log('Connected to MongoDB');
    } catch (error) {
      console.error('Error connecting to MongoDB:', error);
    }
  }
  await connect();

  const db = client.db(dbName);
  const bucket = new GridFSBucket(db);
  const videoPath = fileName;

  var videoId; // Replace with the ID of the video file stored in MongoDB

  async function convertLargeFile() {
    fs.readFile(videoPath, (error, data) => {
      if (error) {
        console.error('Failed to read video file:', error);
        return;
      }
      const uploadStream = bucket.openUploadStream(fileName);
      uploadStream.write(data);
      uploadStream.end();
      // console.log(db.filename);
      // console.log(db.fs.files.length);

      uploadStream.on('finish', () => {
        console.log('Video file uploaded successfully');

        const videoname = uploadStream.filename;
        videoId = uploadStream.id;
        console.log(uploadStream.id)
        console.log(uploadStream.filename)

        // Generate a unique filename for the audio file
        audioFilename = `audio_${videoname}_.mp3`;

        // Convert the video to audio using FFmpeg
        ffmpeg(videoname)
          .output(audioFilename)
          .on('end', async () => {
            // Read the converted audio file
            audioFileData = await fs.promises.readFile(audioFilename);

            fs.readFile(audioFilename, (error, data) => {
              if (error) {
                console.error('Failed to read video file:', error);
                return;
              }
              const uploadStream = bucket.openUploadStream(audioFilename);
              uploadStream.write(data);
              uploadStream.end();
              // console.log(db.filename);
              // console.log(db.fs.files.length);

              uploadStream.on('finish', async () => {
                console.log('Audio file uploaded successfully');

                const { getVideoDurationInSeconds } = require('get-video-duration');
                const duration = await getVideoDurationInSeconds(audioFilename);
                console.log(duration);

                // Update the video document with the audio file data
                // Audio.create({ username: username, videoname: fileName, video: file });
                await Audio.create(
                  {
                    username: username,
                    videoname: fileName,
                    duration: duration,
                    date: new Date(),
                    audioname: audioFilename
                  }

                );
                console.log('Video converted to audio');

                let alert = require('alert');
                alert("File ready to download!");
              });
              uploadStream.on('error', (error) => {
                console.error('Failed to upload audio file:', error);
              });
            });

          })
          .on('error', (error) => {
            console.error('Error converting video to audio:', error);
          })
          .run();

        // const downloadStream = bucket.openDownloadStream(fileId);

      });

      uploadStream.on('error', (error) => {
        console.error('Failed to upload video file:', error);
        // client.close();
      });

    });
  }

  // let audio;
  if (filesize > 16000000) {
    await convertLargeFile();
  } else {
    let audio = await Audio.findOne({ username: username, videoname: fileName, video: file });
    if (!audio) {
      audio = await Audio.create({ username: username, videoname: fileName, video: file });
      console.log("Hello1");
    } else {
      console.log("Hello2");
    }
    videoId = audio._id.toString();
    console.log(videoId)
  }

  async function convertVideoToAudio(videoId) {
    // Get the video document from MongoDB
    console.log("hello1")
    const db = client.db(dbName);
    console.log("hello2")
    const collection = db.collection(collectionName);
    console.log("hello3")
    const video = await Audio.findOne({ _id: videoId });
    console.log("hello4")
    console.log(video.videoname);

    // Generate a unique filename for the audio file
    audioFilename = `audio_${video.videoname}_.mp3`;

    // Convert the video to audio using FFmpeg
    ffmpeg(video.videoname)
      .output(audioFilename)
      .on('end', async () => {
        // Read the converted audio file
        audioFileData = await fs.promises.readFile(audioFilename);

        const { getVideoDurationInSeconds } = require('get-video-duration');
        const duration = await getVideoDurationInSeconds(audioFilename);
        console.log(duration);

        // Update the video document with the audio file data
        await Audio.updateOne(
          { _id: videoId },
          {
            $set: {
              duration: duration,
              date: new Date(),
              audio: audioFileData,
              audioname: audioFilename
            }
          }
        );

        console.log('Video converted to audio');

        let alert = require('alert');
        alert("File ready to download!");
      })
      .on('error', (error) => {
        console.error('Error converting video to audio:', error);
      })
      .run();
  }
  if (videoId) {
    await convertVideoToAudio(videoId);
  }
  // await convertVideoToAudio(videoId);


  // // Note: Provide these AWS settings
  // const awsRegion = 'us-west-1';
  // const bucketName = 'audify-project';
  // const bucketKey = `subtitle-${new Date().getTime()}`;
  // const transcribeJobName = `example-${new Date().getTime()}`;

  // // Note: Provide a URL to a video file
  // const mediaUri = document.video;

  // async function run() {
  //   console.log('Transcribing video using AWS Transcribe...');

  //   // Invoke AWS Transcribe to automatically generate the subtitles from the video
  //   await transcribe(transcribeJobName, mediaUri, awsRegion, bucketName, bucketKey);

  //   // Create subtitle keyframes
  //   const subtitleKeyframes = await generateSubtitles(awsRegion, bucketName, bucketKey);

  //   console.log('Creating video with Creatomate...');

  //   // Create the video. Note that we don't provide an output width and height,
  //   // as the Creatomate API detects these automatically based on the first found video element
  //   const source = new Creatomate.Source({
  //     outputFormat: 'mp4',
  //     elements: [
  //       // The video file. Since we do not specify a duration, the length of the video element
  //       // is determined by the video file provided
  //       new Creatomate.Video({
  //         source: mediaUri,
  //       }),
  //       // The subtitles
  //       new Creatomate.Text({
  //         // Make the subtitle container as large as the screen with some padding
  //         width: '100%',
  //         height: '100%',
  //         xPadding: '3 vmin',
  //         yPadding: '8 vmin',

  //         // Align text to bottom center
  //         xAlignment: '50%',
  //         yAlignment: '100%',

  //         // Text style – note that the default fill color is null (transparent)
  //         fontWeight: '800',
  //         fontSize: '8.48 vh',
  //         fillColor: null,
  //         shadowColor: 'rgba(0,0,0,0.65)',
  //         shadowBlur: '1.6 vmin',

  //         text: subtitleKeyframes,
  //       }),
  //       // Progress bar
  //       new Creatomate.Rectangle({
  //         x: '0%',
  //         y: '0%',
  //         width: '100%',
  //         height: '3%',
  //         xAnchor: '0%',
  //         yAnchor: '0%',
  //         fillColor: '#fff',
  //         animations: [
  //           new Creatomate.Wipe({
  //             xAnchor: '0%',
  //             fade: false,
  //             easing: 'linear',
  //           }),
  //         ],
  //       }),

  //     ],
  //   });

  //   // Render the video
  //   const renders = await client.render({ source });
  //   console.log('Completed:', renders);
  // }

  // run()
  //   .catch(error => console.error(error));


});

app.get('/download', async (req, res) => {
  // Logic to generate and send the file
  console.log('button was clicked');

  await fs.promises.writeFile(audioFilename, audioFileData);

  console.log('audio file downloaded ');
  let alert = require('alert');
  alert("Audio file downloaded!");

  // const electron = require('electron');
  // const BrowserWindow = electron.remote.BrowserWindow;

  // // Keep a global reference of the window object
  // const mainWindow = new BrowserWindow({
  //   width: 800,
  //   height: 600,
  //   webPreferences: {
  //     nodeIntegration: true,
  //     enableRemoteModule: true
  //   }
  // });

  // dialog
  //   .showSaveDialog(mainWindow, {
  //     title: 'Save File',
  //     defaultPath: path.join(app.getPath('downloads'), audioFilename),
  //     filters: [
  //       { name: 'All Files', extensions: ['*'] },
  //     ],
  //   })
  //   .then((result) => {
  //     if (!result.canceled) {
  //       // Retrieve the file path selected by the user
  //       const filePath = result.filePath;

  //       // Trigger the file download
  //       mainWindow.webContents.downloadURL(audioFileData, filePath);
  //     }
  //   })
  //   .catch((err) => {
  //     console.log(err);
  //   });

  res.redirect("/secrets");
  // window.location = "./download"
  // const Window = require('window');
  // const window = new Window();
  // window.document.alert(window.document.location);
  // window.open(url, '_blank');
});


app.get("/logout", function (req, res) {
  req.logout(function (err) {
    if (err) {
      console.log(err);
    } else {
      res.redirect("/");
    }
  });
});



app.listen(process.env.PORT || 3000, function () {
  console.log('Server started on port 3000.');
});
