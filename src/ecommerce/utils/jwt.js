require('dotenv').config();
const jwt = require('jsonwebtoken');





exports.generateToken = (user, duration = '24h')=>{
     const token = jwt.sign(
            { 
              userId: user.user_id,
              email: user.email,
              role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: duration }
          );
      return token;
};

exports.verifyToken = (token) => {
  if (!token) {
    return null
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if(err){
        return null
    }
    return decoded;

  })


}

exports.generateRandomToken = ()=>{
  const token = Math.random().toString(36).substring(2, 15)
  + Math.random().toString(36).substring(2, 15);
  return token;
}
