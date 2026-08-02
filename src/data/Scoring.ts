/**
 * 实时评分：基于已播放部分，统计用户对每个旋律音符的命中时长比例。
 * 命中定义：当前时刻有旋律目标音（非休止）且麦克风清晰，
 *          八度等价下 |cents| <= tolerance（默认 50¢）。
 *
 * 评分 = sum(每个音符的命中时长) / sum(每个音符已播放的有效时长)，
 * 其中「有效时长」= 该音符开始到现在的时间，且麦克风在唱（清晰）。
 * 麦克风没唱的时段不计入分母（不惩罚沉默）。
 *
 * 不依赖旋律内容，只按音符索引累加命中/应唱时长。
 */
export class Scoring {
  /** 每个音符的命中时长（秒），按音符索引。 */
  private hit = new Map<number, number>();
  /** 每个音符「应唱且用户有发声」的时长（秒），按音符索引。 */
  private attempted = new Map<number, number>();
  private lastT = 0;

  /** 切歌时重置统计。 */
  reset(): void {
    this.hit.clear();
    this.attempted.clear();
    this.lastT = 0;
  }

  /**
   * 每帧更新。
   * @param t         当前播放时间（秒）。
   * @param activeIdx 当前目标音符索引（-1 表示无目标/休止）。
   * @param isHit     当前是否命中（清晰 + 八度等价准）。
   * @param singing   当前用户是否在发声（清晰度达标）。
   */
  update(t: number, activeIdx: number, isHit: boolean, singing: boolean): void {
    const dt = t - this.lastT;
    this.lastT = t;
    if (dt <= 0 || dt > 0.5) return; // 跳帧/seek 不累计

    if (activeIdx < 0) return; // 无目标，不影响分数
    if (!singing) return; // 沉默不计入分母

    this.attempted.set(
      activeIdx,
      (this.attempted.get(activeIdx) ?? 0) + dt,
    );
    if (isHit) {
      this.hit.set(activeIdx, (this.hit.get(activeIdx) ?? 0) + dt);
    }
  }

  /** 当前得分（0..100）。无应唱数据时返回 null。 */
  score(): number | null {
    let totalHit = 0;
    let totalAttempted = 0;
    for (const v of this.attempted.values()) totalAttempted += v;
    for (const v of this.hit.values()) totalHit += v;
    if (totalAttempted < 0.2) return null; // 样本太少
    return Math.round((totalHit / totalAttempted) * 100);
  }
}
