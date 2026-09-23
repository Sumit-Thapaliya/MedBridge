const { ApiError } = require("../utils/ApiError");

// Usage: router.post("/", validate(schema), controller)
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new ApiError(400, "Invalid request body", result.error.flatten()));
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
