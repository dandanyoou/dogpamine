// Dogpamine — Mock 콘텐츠 데이터
// 두 카테고리: 'high' (취향 / 고도파민) + 'low' (저자극 / 평화로움·뉴스)
// 실제 영상 대신 그라데이션 + 이모지 + 제목으로 시각화.
// 팀이 나중에 실제 영상 URL로 교체할 때 video_url 필드만 채우면 됨.

const CONTENT = {
  high: [
    { emoji: '🐶', title: '오늘의 댕댕이 모음', desc: '시바견이 미끄러지는데 너무 웃겨', bg: 'linear-gradient(135deg, #ff9a8b, #ff6a88, #ff99ac)' },
    { emoji: '🍔', title: '강남 신상 버거집', desc: '치즈가 진짜 폭포처럼 흘러내림', bg: 'linear-gradient(135deg, #ffd89b, #ff7e5f)' },
    { emoji: '💪', title: '3대 500 달성 챌린지', desc: '벤치프레스 PR 갱신 순간', bg: 'linear-gradient(135deg, #f093fb, #f5576c)' },
    { emoji: '🎮', title: 'GTA 클러치 모음', desc: '0.1초 차이로 살아남는 거 미쳤다', bg: 'linear-gradient(135deg, #4facfe, #00f2fe)' },
    { emoji: '😂', title: '직장인 빡침 짤', desc: '월요일 아침 출근길 표정', bg: 'linear-gradient(135deg, #fa709a, #fee140)' },
    { emoji: '🐕', title: '리트리버 첫 수영', desc: '귀가 날아다님', bg: 'linear-gradient(135deg, #fbc2eb, #a6c1ee)' },
    { emoji: '🍕', title: '뉴욕 피자 1조각 후기', desc: '한 조각이 얼굴만함', bg: 'linear-gradient(135deg, #fdcb6e, #e17055)' },
    { emoji: '🏋️', title: '데드리프트 폼 체크', desc: '허리 안 다치는 법', bg: 'linear-gradient(135deg, #a18cd1, #fbc2eb)' },
    { emoji: '🐱', title: '냥냥펀치 슬로우모션', desc: '이 자식 진심임', bg: 'linear-gradient(135deg, #fccb90, #d57eeb)' },
    { emoji: '🍜', title: '돈코츠 라멘 끓이기', desc: '국물이 진짜 미쳤음', bg: 'linear-gradient(135deg, #ee9ca7, #ffdde1)' },
    { emoji: '🤸', title: '체조 선수 백덤블링', desc: '슬로우로 보면 더 미친 거', bg: 'linear-gradient(135deg, #ff6e7f, #bfe9ff)' },
    { emoji: '🌮', title: '멕시코 노점 타코', desc: '5천원에 이 정도면 인생타코', bg: 'linear-gradient(135deg, #ffecd2, #fcb69f)' },
    { emoji: '🐶', title: '강아지 vs 청소기', desc: '청소기가 무서운 강쥐', bg: 'linear-gradient(135deg, #ff9a9e, #fad0c4)' },
    { emoji: '🎯', title: '다트 만점 챌린지', desc: '7번 만에 성공', bg: 'linear-gradient(135deg, #84fab0, #8fd3f4)' },
    { emoji: '😹', title: '고양이 점프 실패', desc: '냉장고 위 노린 결과', bg: 'linear-gradient(135deg, #f6d365, #fda085)' },
  ],
  low: [
    { emoji: '🌊', title: '파도 소리 30분', desc: '동해안에서 녹음한 자연음', bg: 'linear-gradient(135deg, #4b6cb7, #182848)' },
    { emoji: '📰', title: '오늘의 경제 지표', desc: '코스피 0.3% 하락, 환율 변동성 확대', bg: 'linear-gradient(135deg, #485563, #29323c)' },
    { emoji: '📊', title: '한국은행 기준금리 동결', desc: '연 3.5% 유지, 향후 인하 시점 주목', bg: 'linear-gradient(135deg, #3e5151, #decba4)' },
    { emoji: '🌲', title: '강원도 숲길 워킹', desc: '아무 일도 일어나지 않습니다', bg: 'linear-gradient(135deg, #606c88, #3f4c6b)' },
    { emoji: '📜', title: '부동산 공시지가 발표', desc: '서울 평균 1.79% 상승', bg: 'linear-gradient(135deg, #757f9a, #d7dde8)' },
    { emoji: '🏞️', title: '호수 잔잔한 풍경', desc: '바람이 가끔 부는 정도', bg: 'linear-gradient(135deg, #5d4157, #a8caba)' },
    { emoji: '📈', title: '미국 CPI 발표 분석', desc: '근원 인플레이션 둔화 추세', bg: 'linear-gradient(135deg, #283e51, #485563)' },
    { emoji: '🍃', title: '나뭇잎 바람에 흔들림', desc: '4분짜리 정적 영상', bg: 'linear-gradient(135deg, #8e9eab, #eef2f3)' },
    { emoji: '📋', title: '국정감사 주요 발언', desc: '여야 의원 질의응답 요약', bg: 'linear-gradient(135deg, #434343, #000000)' },
    { emoji: '🌧️', title: '비 오는 카페 창문', desc: '빗방울 떨어지는 소리', bg: 'linear-gradient(135deg, #355c7d, #6c5b7b)' },
    { emoji: '📑', title: 'OECD 한국 성장률 전망', desc: '내년 2.3% 예측, 하향 조정', bg: 'linear-gradient(135deg, #2c3e50, #4ca1af)' },
    { emoji: '🕯️', title: '촛불 1시간 영상', desc: '불꽃이 조용히 흔들림', bg: 'linear-gradient(135deg, #232526, #414345)' },
    { emoji: '📺', title: '환경부 정책 브리핑', desc: '탄소중립 로드맵 2단계 발표', bg: 'linear-gradient(135deg, #485563, #29323c)' },
    { emoji: '🌫️', title: '안개 낀 새벽 도로', desc: '아무도 없는 길', bg: 'linear-gradient(135deg, #6a85b6, #bac8e0)' },
    { emoji: '📃', title: '금융위 가계대출 통계', desc: '신규 대출 전월 대비 감소', bg: 'linear-gradient(135deg, #373b44, #4286f4)' },
  ],
};
