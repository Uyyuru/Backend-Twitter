const express = require('express')
const {open} = require('sqlite')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const sqlite3 = require('sqlite3')
const app = express()

app.use(express.json())
const path = require('path')
let db = null
const dbPath = path.join(__dirname, 'twitterClone.db')

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server is running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(e.message)
  }
}

initializeDBAndServer()

const authenticateToken = (request, response, next) => {
  let jwtToken
  let authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'SECRET', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.payload = payload
        next()
      }
    })
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body

  const regQuery = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(regQuery)

  if (dbUser !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else if (password.length < 6) {
    response.status(400)
    response.send('Password is too short')
  } else {
    const hashedPass = await bcrypt.hash(password, 10)
    const createUserQuery = `INSERT INTO user (username, name, password, gender)
      VALUES (
        '${username}',
        '${name}',
        '${hashedPass}',
        '${gender}'
      );`
    await db.run(createUserQuery)
    response.status(200)
    response.send('User created successfully')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const loginQuery = `SELECT * FROM user WHERE username='${username}'`
  const dbUser = await db.get(loginQuery)

  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'SECRET')
      response.status(200)
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request.payload
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)

  const getTweetFeedQuery = `
    SELECT username, tweet, date_time AS dateTime
    FROM follower 
    INNER JOIN tweet ON follower.following_user_id = tweet.user_id
    INNER JOIN user ON user.user_id = tweet.user_id
    WHERE follower.follower_user_id = ${dbUser.user_id}
    ORDER BY date_time DESC
    LIMIT 4;`
  const tweetFeed = await db.all(getTweetFeedQuery)
  response.send(tweetFeed)
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const {user_id} = request.payload
  const followersQuery = `
    SELECT name 
    FROM user 
    INNER JOIN follower ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${user_id};`
  const userFollowing = await db.all(followersQuery)
  response.send(userFollowing)
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {user_id} = request.payload
  const followersQuery = `
    SELECT name 
    FROM user 
    INNER JOIN follower ON user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = ${user_id};`
  const userFollowers = await db.all(followersQuery)
  response.send(userFollowers)
})

app.get('/tweets/:tweetId', authenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const {user_id} = request.payload

  const tweetQuery = `SELECT * FROM tweet WHERE tweet_id = '${tweetId}';`
  const tweetRes = await db.get(tweetQuery)

  if (tweetRes !== undefined) {
    const userFollowerQuery = `
      SELECT * FROM follower 
      INNER JOIN user ON user.user_id = follower.following_user_id
      WHERE follower.follower_user_id = '${user_id}';`
    const userFollowers = await db.all(userFollowerQuery)

    if (
      userFollowers.some(item => item.following_user_id === tweetRes.user_id)
    ) {
      const getTweetDetailsQuery = `
        SELECT tweet, 
        COUNT(DISTINCT like.like_id) AS likes,
        COUNT(DISTINCT reply.reply_id) AS replies,
        tweet.date_time AS dateTime
        FROM tweet 
        LEFT JOIN like ON tweet.tweet_id = like.tweet_id 
        LEFT JOIN reply ON reply.tweet_id = tweet.tweet_id
        WHERE tweet.tweet_id = '${tweetId}';`
      const tweetDetails = await db.get(getTweetDetailsQuery)
      response.send(tweetDetails)
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {user_id} = request.payload

    const tweetQuery = `SELECT * FROM tweet WHERE tweet_id = '${tweetId}';`
    const tweetRes = await db.get(tweetQuery)

    const userFollowerQuery = `
    SELECT * FROM follower 
    INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = '${user_id}';`
    const userFollowers = await db.all(userFollowerQuery)

    if (
      userFollowers.some(item => item.following_user_id === tweetRes.user_id)
    ) {
      const getLikesQuery = `
      SELECT username 
      FROM user 
      INNER JOIN like ON user.user_id = like.user_id
      WHERE like.tweet_id = '${tweetId}';`
      const likedUsers = await db.all(getLikesQuery)
      response.send({likes: likedUsers.map(user => user.username)})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {user_id} = request.payload

    const tweetQuery = `SELECT * FROM tweet WHERE tweet_id = '${tweetId}';`
    const tweetRes = await db.get(tweetQuery)

    const userFollowerQuery = `
    SELECT * FROM follower 
    INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = '${user_id}';`
    const userFollowers = await db.all(userFollowerQuery)

    if (
      userFollowers.some(item => item.following_user_id === tweetRes.user_id)
    ) {
      const getRepliesQuery = `
      SELECT name, reply 
      FROM user 
      INNER JOIN reply ON user.user_id = reply.user_id
      WHERE reply.tweet_id = '${tweetId}';`
      const tweetReplies = await db.all(getRepliesQuery)
      response.send({replies: tweetReplies})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {user_id} = request.payload

  const userTweetQuery = `
    SELECT tweet.tweet, 
    COUNT(DISTINCT like.like_id) AS likes,
    COUNT(DISTINCT reply.reply_id) AS replies,
    tweet.date_time AS dateTime 
    FROM tweet 
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = '${user_id}';`
  const userTweets = await db.all(userTweetQuery)
  response.send(userTweets)
})

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {user_id} = request.payload
    const {tweetId} = request.params

    const getTweetQuery = `SELECT * FROM tweet WHERE tweet_id = '${tweetId}';`
    const tweetRes = await db.get(getTweetQuery)

    if (tweetRes === undefined) {
      response.status(400)
      response.send('Invalid Request')
    } else if (tweetRes.user_id !== user_id) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`
      await db.run(deleteTweetQuery)
      response.status(200)
      response.send('Tweet Removed')
    }
  },
)

module.exports = app
