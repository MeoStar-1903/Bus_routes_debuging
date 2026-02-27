// [ADDED] Routes auth: POST /api/auth/register, POST /api/auth/login
const express = require('express');
const authController = require('../controllers/auth.controller');

const router = express.Router();
router.post('/register', authController.register);
router.post('/login', authController.login);

module.exports = router;
