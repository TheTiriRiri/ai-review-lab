# Generated from reviewer/src/review-schema.ts by npm run schema:emit: the verdict VERDICT_RULE gives the scores.
if .criteria.implementationCorrectness.score <= 5
  or .criteria.securitySafety.score <= 4
  or ([.criteria.implementationCorrectness.score, .criteria.idiomaticity.score, .criteria.complexity.score, .criteria.testRiskCoverage.score, .criteria.documentation.score, .criteria.securitySafety.score] | min) <= 3
then "fail" else "pass" end
