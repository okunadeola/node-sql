const Joi = require('joi');

const productSchema = Joi.object({
  name: Joi.string().min(3).max(255).required(),
  price: Joi.number().positive().precision(2).required(),
  description: Joi.string().allow('').optional(),
  category_id: Joi.string().uuid().required()
});

const orderSchema = Joi.object({
  items: Joi.array().items(
    Joi.object({
      productId: Joi.string().uuid().required(),
      quantity: Joi.number().integer().min(1).required()
    })
  ).min(1).required(),
  shippingAddress: Joi.object().required()
});

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      status: 'fail',
      errors: error.details.map(err => ({
        field: err.context.key,
        message: err.message.replace(/"/g, '')
      }))
    });
  }
  next();
};

module.exports = {
  validateProduct: validate(productSchema),
  validateOrder: validate(orderSchema)
};