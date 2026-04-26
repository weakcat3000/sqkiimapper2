import {
  computeConfidenceLabel,
  filterCandidatesInsideCoinCircle,
  groupCandidatesByProximity,
  validateCandidateInsideCoinCircle
} from './jigsawUtils.js';

export async function checkStreetViewAvailability(candidate) {
  await new Promise((resolve) => setTimeout(resolve, 120));
  return {
    available: Number.isFinite(Number(candidate?.lat)) && Number.isFinite(Number(candidate?.lng)),
    limitations: ['Mock availability check only. Manual verification required.']
  };
}

export async function compareWithStreetView(inputImageUrl, candidate, coin) {
  const validated = validateCandidateInsideCoinCircle(candidate, coin);
  if (!validated.inside_radius) {
    return {
      available: false,
      verification_score: 0,
      matching_features: [],
      mismatching_features: ['Candidate is outside selected coin radius.'],
      limitations: ['Street View verification was skipped by the hard radius boundary.']
    };
  }

  const availability = await checkStreetViewAvailability(candidate);
  const base = Math.max(0.35, Math.min(0.88, 0.9 - (Number(validated.distance_from_coin_center_m || 0) / Math.max(1, Number(coin.radius_m || 1))) * 0.22));
  return {
    available: availability.available,
    verification_score: Math.round(base * 100) / 100,
    best_heading: 90,
    matching_features: ['public walkway context', 'greenery / open-space balance'],
    mismatching_features: ['exact camera angle unknown in mock mode'],
    limitations: ['Mock Street View check. Do not store Street View images permanently. Manual verification required.']
  };
}

export function flattenAgentCandidates(agentResults = []) {
  const flattened = [];
  for (const result of agentResults || []) {
    const agentName = result?.agent_name || 'Unknown agent';
    const add = (candidate, rank) => {
      if (!candidate) return;
      flattened.push({
        ...candidate,
        agent_name: agentName,
        agent_rank: rank,
        visual_clues: result.visual_clues || [],
        limitations: result.limitations || []
      });
    };
    add(result.primary_candidate, 'primary');
    for (const candidate of (result.alternate_candidates || [])) add(candidate, 'alternate');
  }
  return flattened;
}

export async function runWeightedVoting({ agentResults = [], coin, notes = '', inputImageUrl = '' }) {
  const flattened = flattenAgentCandidates(agentResults);
  const { validCandidates, rejectedOutsideRadiusCandidates, validatedCandidates } = filterCandidatesInsideCoinCircle(flattened, coin);
  let groups = groupCandidatesByProximity(validCandidates);

  const streetviewResults = [];
  const topGroups = groups.slice(0, 3);
  for (const group of topGroups) {
    const verification = await compareWithStreetView(inputImageUrl, group.representative, coin);
    streetviewResults.push({
      group_id: group.id,
      candidate_name: group.location_name,
      ...verification
    });
  }

  groups = groups.map((group) => {
    const street = streetviewResults.find((item) => item.group_id === group.id);
    const agreementScore = Math.min(1, group.agents.length / 3);
    const streetScore = Number(street?.verification_score || 0);
    const referenceScore = group.members.some((item) => /reference/i.test(item.agent_name || '')) ? 0.72 : 0.45;
    const avgConfidence = Math.max(0, Math.min(1, Number(group.average_model_confidence || 0)));
    const notesScore = notes ? 0.64 : 0.45;
    const radiusFit = Math.max(0, 1 - (Number(group.representative.distance_from_coin_center_m || 0) / Math.max(1, Number(coin.radius_m || 1))));
    const weightedScore = (
      agreementScore * 0.35
      + streetScore * 0.25
      + referenceScore * 0.20
      + avgConfidence * 0.10
      + notesScore * 0.05
      + radiusFit * 0.05
    );

    return {
      ...group,
      streetview: street || null,
      weighted_score: Math.round(weightedScore * 1000) / 10,
      model_votes: Object.fromEntries(group.agents.map((agent) => [agent, true])),
      label: group.agents.length >= 3 ? '3/3 inside-radius agreement' : group.agents.length >= 2 ? '2/3 inside-radius agreement' : 'single-model valid candidate'
    };
  }).sort((a, b) => b.weighted_score - a.weighted_score);

  const finalLabel = computeConfidenceLabel(groups, validCandidates);
  const topCandidate = groups[0] || null;
  return {
    final_label: finalLabel,
    final_score: topCandidate ? topCandidate.weighted_score : 0,
    top_candidate: topCandidate,
    candidate_groups: groups,
    rejected_candidates: rejectedOutsideRadiusCandidates,
    validated_candidates: validatedCandidates,
    streetview_results: streetviewResults,
    model_votes: agentResults.map((result) => ({
      agent_name: result.agent_name,
      candidate_count: 1 + (result.alternate_candidates || []).length
    })),
    reasoning: topCandidate
      ? `Weighted voting used only ${validCandidates.length} inside-radius candidate(s). Outside-radius guesses were rejected before scoring.`
      : 'All model candidates were outside the selected coin radius or had invalid coordinates.',
    limitations: [
      'Mock agents are placeholders until real model APIs are connected.',
      'AI results are approximate and require manual verification.',
      'Outside-radius model agreement is ignored.'
    ]
  };
}

