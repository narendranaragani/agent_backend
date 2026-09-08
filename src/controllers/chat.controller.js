import { getRAGResponse } from "../services/rag.service.js";

// POST /api/chat/message
export const sendMessage = async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ success: false, message: "Message is required." });
      return;
    }

    const answer = await getRAGResponse(message.trim());

    res.json({ success: true, data: { message: answer } });
  } catch (error) {
    next(error);
  }
};


