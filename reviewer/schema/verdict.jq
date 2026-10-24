# Generated from reviewer/src/review-schema.ts by npm run schema:emit: the verdict VERDICT_RULE gives the scores.
def check($key): .criteria[$key].score as $s
  | if ($s | type) == "number" and $s == ($s | floor) and $s >= 1 and $s <= 10 then .
    else error("criterion \($key) has score \($s | tojson); expected an integer from 1 to 10") end;
check("implementationCorrectness") | check("idiomaticity") | check("complexity") | check("testRiskCoverage") | check("documentation") | check("securitySafety")
| if .criteria.implementationCorrectness.score <= 5
  or .criteria.securitySafety.score <= 4
  or ([.criteria.implementationCorrectness.score, .criteria.idiomaticity.score, .criteria.complexity.score, .criteria.testRiskCoverage.score, .criteria.documentation.score, .criteria.securitySafety.score] | min) <= 3
then "fail" else "pass" end
