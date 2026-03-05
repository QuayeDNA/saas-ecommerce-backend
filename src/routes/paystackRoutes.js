import express from 'express';
import paystackController from '../controllers/paystackController.js';

const router = express.Router();

// Public webhook endpoint - signature verification happens in controller
router.post('/', paystackController.handleWebhook.bind(paystackController));

export default router;
