const Joi = require('joi');

const schemas = {
  search: Joi.object({
    cabinClass: Joi.string().valid('ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST').default('ECONOMY'),
    paxInfo: Joi.object({
      ADULT: Joi.string().required(),
      CHILD: Joi.string().default('0'),
      INFANT: Joi.string().default('0'),
    }).required(),
    routeInfos: Joi.array().items(
      Joi.object({
        fromCityOrAirport: Joi.object({ code: Joi.string().required() }).required(),
        toCityOrAirport: Joi.object({ code: Joi.string().required() }).required(),
        travelDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      })
    ).min(1).required(),
    searchModifiers: Joi.object({
      isDirectFlight: Joi.boolean().default(false),
      isConnectingFlight: Joi.boolean().default(false),
      pft: Joi.string().valid('REGULAR', 'STUDENT', 'SENIOR_CITIZEN').default('REGULAR'),
    }),
    preferredAirline: Joi.array().items(Joi.object({ code: Joi.string() })).max(10),
  }),

  review: Joi.object({
    priceIds: Joi.array().items(Joi.string()).min(1).max(2).required(),
  }),

  fareRule: Joi.object({
    id: Joi.string().required(),
    flowType: Joi.string().valid('SEARCH', 'REVIEW', 'BOOKING_DETAIL').required(),
  }),

  seatMap: Joi.object({
    bookingId: Joi.string().required(),
  }),

  book: Joi.object({
    bookingId: Joi.string().required(),
    paymentInfos: Joi.array().items(Joi.object({ amount: Joi.number().required() })),
    deliveryInfo: Joi.object({
      emails: Joi.array().items(Joi.string().email()).required(),
      contacts: Joi.array().items(Joi.string()).required(),
    }).required(),
    contactInfo: Joi.object({
      emails: Joi.array().items(Joi.string().email()),
      contacts: Joi.array().items(Joi.string()),
      ecn: Joi.string(),
    }),
    travellerInfo: Joi.array().items(
      Joi.object({
        ti: Joi.string().required(),
        pt: Joi.string().valid('ADULT', 'CHILD', 'INFANT').required(),
        fN: Joi.string().required(),
        lN: Joi.string().required(),
        dob: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
        pNum: Joi.string(),
        eD: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
        pNat: Joi.string().length(2),
        pid: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
        pan: Joi.string(),
        di: Joi.string(),
        ssrBaggageInfos: Joi.array().items(Joi.object({ key: Joi.string(), code: Joi.string() })),
        ssrMealInfos: Joi.array().items(Joi.object({ key: Joi.string(), code: Joi.string() })),
        ssrSeatInfos: Joi.array().items(Joi.object({ key: Joi.string(), code: Joi.string() })),
        ssrExtraServiceInfos: Joi.array().items(Joi.object({ key: Joi.string(), code: Joi.string() })),
      })
    ).min(1).required(),
    gstInfo: Joi.object({
      gstNumber: Joi.string().length(15),
      registeredName: Joi.string().max(35),
      email: Joi.string().email(),
      mobile: Joi.string(),
      address: Joi.string().max(70),
    }),
    // optional metadata passed by cnkb2b / cnk-website for DB record linking
    _meta: Joi.object({
      createdBy: Joi.string(),
      searchParams: Joi.object(),
    }),
  }),

  fareValidate: Joi.object({
    bookingId: Joi.string().required(),
  }),

  confirmBook: Joi.object({
    bookingId: Joi.string().required(),
    paymentInfos: Joi.array().items(Joi.object({ amount: Joi.number().required() })).min(1).required(),
  }),

  bookingDetails: Joi.object({
    bookingId: Joi.string().required(),
    requirePaxPricing: Joi.boolean().default(true),
  }),

  unhold: Joi.object({
    bookingId: Joi.string().required(),
    pnrs: Joi.array().items(Joi.string()).min(1).required(),
  }),

  amendmentCharges: Joi.object({
    bookingId: Joi.string().required(),
    type: Joi.string().valid('CANCELLATION').default('CANCELLATION'),
    remarks: Joi.string(),
    trips: Joi.array().items(
      Joi.object({
        src: Joi.string().required(),
        dest: Joi.string().required(),
        departureDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        travellers: Joi.array().items(
          Joi.object({ fn: Joi.string().required(), ln: Joi.string().required() })
        ).min(1).required(),
      })
    ).min(1).required(),
  }),

  amendmentDetails: Joi.object({
    amendmentId: Joi.string().required(),
  }),
};

function validateRequest(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) return next();

    const { error, value } = schema.validate(req.body, { abortEarly: false, allowUnknown: false });
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map((d) => d.message),
      });
    }

    req.body = value;
    next();
  };
}

module.exports = validateRequest;
