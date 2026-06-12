---
name: backend-development
description: Write production-grade Node.js/Express backend code. Use this skill whenever the user asks to "create an endpoint", "add a backend route", "write an API", "setup express", or mentions anything about server-side business logic, controllers, models, or database queries. Ensure you use this skill instead of writing raw tutorial-level code.
---

# Node.js/Express Ultra-Advanced Enterprise Backend Skill

Whenever you write backend code in Node.js and Express for this project, you **MUST** adhere to the following enterprise-grade standards. Never output messy, tutorial-style Express files. You must act as a Senior Backend Engineer at a top-tier tech company.

## 1. The 5-Layer Architecture (Strict Isolation)
Never write business logic or database queries directly inside route definitions or controllers. You must strictly separate concerns across five layers:

1. **Routes (`routes/*.js`)**: Map HTTP methods to Controller functions. **MUST** include API versioning (e.g., `/api/v1/...`) and apply authentication/RBAC middleware.
2. **Controllers (`controllers/*.js`)**: Handle HTTP Request/Response objects. Extract `req.body`, `req.params`, or `req.query`, pass data to the Service, and return the `res.status().json()`.
3. **Services (`services/*.js`)**: Contain 100% of the business logic. They do NOT know about Express (no `req` or `res`) and they do NOT know about the Database ORM directly.
4. **Repositories (`repositories/*.js`)**: The **only** layer allowed to touch the database (e.g., Mongoose, Prisma, SQL). Services must call Repository methods (e.g., `UserRepository.findByEmail(email)`).
5. **DTOs (Data Transfer Objects)**: Services must return cleaned DTOs, never raw database documents, to prevent leaking fields like `passwordHash` or `__v`.

## 2. Advanced Security & RBAC
- **Environment Validation**: Enforce that `process.env` is validated on server startup (using Zod or Joi) to ensure no critical secrets are missing.
- **Role-Based Access Control**: Secure routes using a strict middleware chain.
  Example: `router.post('/', requireAuth, restrictTo('admin'), controller.create);`

## 3. Centralized Error Handling & Async Safety
- Use a custom `AppError` class to standardize errors.
- You **MUST** wrap all asynchronous controllers with an `express-async-handler` (or a custom `catchAsync` wrapper) to catch unhandled promise rejections.
- Implement a global error-handling middleware (`app.use((err, req, res, next) => {...})`) to intercept these errors.

## 4. Strict Input Validation (Zod/Joi)
Validate all data (`req.body`, `req.params`, `req.query`) *before* it reaches the controller.
- Use a validation library (like **Zod**).
- Create a validation middleware that intercepts bad data and throws a 400 `AppError` immediately.

## 5. Standardized Pagination, Filtering, & Sorting
For GET requests returning lists, standardize the query handling.
- E.g., `/api/v1/users?role=admin&sort=-createdAt&page=2&limit=50`
- Use an `APIFeatures` class or utility in the Repository layer to parse these queries uniformly.

## 6. Structured Logging
Never leave `console.log()` in production code. 
- Assume a structured logger (like **Winston** or **Pino**) is configured. 
- Log operational events, request metadata, and errors using `logger.info()` or `logger.error()`.

---

## Output Example: The Enterprise Standard

1. **The Route (`routes/v1/userRoutes.js`)**:
```javascript
const express = require('express');
const userController = require('../../controllers/userController');
const { validate } = require('../../middlewares/validate');
const { requireAuth, restrictTo } = require('../../middlewares/auth');
const { createUserSchema } = require('../../schemas/userSchemas');

const router = express.Router();

// Strict middleware chain: Auth -> RBAC -> Validation -> Controller
router.post(
  '/',
  requireAuth,
  restrictTo('admin'),
  validate(createUserSchema),
  userController.createUser
);

module.exports = router;
```

2. **The Controller (`controllers/userController.js`)**:
```javascript
const catchAsync = require('../utils/catchAsync');
const userService = require('../services/userService');

exports.createUser = catchAsync(async (req, res, next) => {
  // Pass to service, return DTO
  const userDTO = await userService.createUser(req.body);
  
  res.status(201).json({
    status: 'success',
    data: { user: userDTO }
  });
});
```

3. **The Service (`services/userService.js`)**:
```javascript
const userRepository = require('../repositories/userRepository');
const AppError = require('../utils/appError');
const UserDTO = require('../dtos/userDTO');

exports.createUser = async (userData) => {
  // Business logic checks
  const existingUser = await userRepository.findByEmail(userData.email);
  if (existingUser) throw new AppError('Email already in use', 400);
  
  // Create via repository
  const newUser = await userRepository.create(userData);
  
  // Return safe DTO, never the raw DB object
  return new UserDTO(newUser);
};
```

4. **The Repository (`repositories/userRepository.js`)**:
```javascript
// The ONLY layer that knows about Mongoose/Prisma/SQL
const User = require('../models/User');

exports.findByEmail = async (email) => {
  return await User.findOne({ email }).lean();
};

exports.create = async (data) => {
  return await User.create(data);
};
```
