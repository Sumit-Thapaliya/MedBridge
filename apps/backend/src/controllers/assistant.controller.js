const { asyncHandler } = require("../utils/asyncHandler");
const AIService = require("../services/ai/AIService");
const { ApiError } = require("../utils/ApiError");

/**
 * Assistant Controller - Production LLM endpoints
 */

const ask = asyncHandler(async (req, res) => {
  const { question, message, conversationId } = req.body;

  const q = (question || message || "").trim();
  if (!q) {
    throw new ApiError(400, "Question is required");
  }

  if (q.length > 4000) {
    throw new ApiError(400, "Question too long (max 4000 characters)");
  }

  const hospitalName = req.user.hospitalId ? undefined : "Unknown";
  let resolvedHospitalName = hospitalName;

  try {
    const prisma = require("../config/db");
    const hospital = await prisma.hospital.findUnique({ where: { id: req.user.hospitalId } }).catch(() => null);
    if (hospital) resolvedHospitalName = hospital.name;
  } catch {}

  const result = await AIService.askQuestion({
    question: q,
    userId: req.user.id,
    hospitalId: req.user.hospitalId,
    hospitalName: resolvedHospitalName,
    conversationId: conversationId || null,
  });

  res.json(result);
});

const askStream = asyncHandler(async (req, res) => {
  const { question, message, conversationId } = req.body;
  const q = (question || message || "").trim();

  if (!q) throw new ApiError(400, "Question is required");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    let hospitalName = "Unknown Hospital";
    try {
      const prisma = require("../config/db");
      const hospital = await prisma.hospital.findUnique({ where: { id: req.user.hospitalId } }).catch(() => null);
      if (hospital) hospitalName = hospital.name;
    } catch {}

    for await (const chunk of AIService.askQuestionStream({
      question: q,
      userId: req.user.id,
      hospitalId: req.user.hospitalId,
      hospitalName,
      conversationId,
    })) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if (chunk.done) break;
    }

    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`);
    res.end();
  }
});

const getHistory = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const result = await AIService.getConversationHistory(conversationId, req.user.id);
  res.json(result);
});

const getConversations = asyncHandler(async (req, res) => {
  const conversations = await AIService.getUserConversations(req.user.id);
  res.json(conversations);
});

const deleteConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const deleted = await AIService.deleteConversation(conversationId, req.user.id);
  if (!deleted) throw new ApiError(404, "Conversation not found or unauthorized");
  res.json({ message: "Conversation deleted" });
});

const getProviderInfo = asyncHandler(async (req, res) => {
  const info = await AIService.getProviderInfo();
  res.json(info);
});

module.exports = {
  ask,
  askStream,
  getHistory,
  getConversations,
  deleteConversation,
  getProviderInfo,
};
