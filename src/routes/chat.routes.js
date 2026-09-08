import { Router } from "express";
import { sendMessage } from "../controllers/chat.controller.js";

const router = Router();
router.post("/message", sendMessage);

export default router;
