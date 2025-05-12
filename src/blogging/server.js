require('dotenv').config();
const User = require('./blogging/models/User');
const Post = require('./blogging/models/Post');
const express = require("express");


const app = express();
const PORT = process.env.PORT || 3002;


// Create a test user and post
const test = async () => {
  const user = await User.create('alice', 'alice@example.com');
  console.log('Created user:', user);

  const postId = await Post.createWithTags(
    user.id, 
    'Learn SQL with Node.js', 
    'A comprehensive guide...', 
    ['sql', 'node', 'backend']
  );
  console.log('Created post ID:', postId);

  const searchResults = await Post.search('guide comprehensive');
  console.log('Search results:', searchResults);
};

test().catch(console.error);





app.listen(PORT, () => {
    console.log(`server running on port ${PORT}`);
  });