'use strict'

import feature1 from './lib/feature1'
import feature2 from './lib/feature2'

export * as feature1 from './lib/feature1'
export * as feature2 from './lib/feature2'

module.exports = { feature1, feature2 }
module.exports.feature1 = feature1
module.exports.feature2 = feature2
module.exports.default = { feature1, feature2 }
