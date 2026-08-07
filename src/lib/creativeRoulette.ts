export const CREATIVE_CONSTRAINTS: string[] = [
  '대사 없이 이 광고를 다시 만들어보세요.',
  '제품을 마지막 1초까지 보여주지 마세요.',
  '모든 카메라를 피사체 뒤에 배치하세요.',
  '현재 컷 수를 절반으로 줄이세요.',
  '첫 장면과 마지막 장면을 동일하게 만들어보세요.',
  '사람 없이 이 광고를 만들어보세요.',
  '모든 shot을 한 개의 lens로 촬영하세요.',
  '제품을 직접 보여주지 말고 그림자로만 표현하세요.',
  '첫 3초 동안 상황을 설명하지 마세요.',
  '모든 장면을 극단적인 close-up으로 구성하세요.',
];

/** Picks a random constraint, avoiding an immediate repeat of `exclude` when more than one option exists. */
export function pickRandomConstraint(exclude?: string): string {
  const pool = exclude && CREATIVE_CONSTRAINTS.length > 1
    ? CREATIVE_CONSTRAINTS.filter((c) => c !== exclude)
    : CREATIVE_CONSTRAINTS;
  return pool[Math.floor(Math.random() * pool.length)];
}
