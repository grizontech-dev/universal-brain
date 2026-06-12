import type { RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  const id = incoming?.trim() || uuidv4();
  req.id = id;
  res.setHeader("x-request-id", id);
  next();
};
