const { ipKeyGenerator, rateLimit } = require('express-rate-limit');

// Skip all rate limiting in test environment so tests can exercise failure paths
// without the limiter's in-memory counters bleeding across test cases.
if (process.env.NODE_ENV === 'test') {
  const noop = (req, res, next) => next();
  module.exports = {
    authRateLimit: noop,
    loginRateLimit: noop,
    registerRateLimit: noop,
    passwordResetRateLimit: noop,
  };
} else {

const standardConfig = {
  standardHeaders: true,
  legacyHeaders: false,
};

const authRateLimit = rateLimit({
  ...standardConfig,
  windowMs: 15 * 60 * 1000,
  max: 110,
  message: { error: 'Too many authentication requests. Please try again later.' },
});

const loginRateLimit = rateLimit({
  ...standardConfig,
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip || 'unknown')}:${String(req.body?.email || req.body?.username || 'unknown').toLowerCase()}`,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

const registerRateLimit = rateLimit({
  ...standardConfig,
  windowMs: 60 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { error: 'Too many signup attempts. Please try again later.' },
});

const passwordResetRateLimit = rateLimit({
  ...standardConfig,
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many password reset requests. Please try again later.' },
});

module.exports = {
  authRateLimit,
  loginRateLimit,
  registerRateLimit,
  passwordResetRateLimit,
};

} // end non-test block