export default defineAppConfig({
  pages: [
    'pages/onboarding/index',
    'pages/home/index',
    'pages/milestones/index',
    'pages/places/index',
    'pages/impressions/index',
    'pages/archive/index',
    'pages/memory/index',
    'pages/games/index',
    'pages/games/dice/index',
    'pages/games/reaction/index',
    'pages/games/quiz/index',
    'pages/games/guess/index',
    'pages/games/flip/index',
    'pages/games/chemistry/index',
    'pages/games/gomoku/index',
    'pages/games/poker/index',
    'pages/games/draw/index',
    'pages/edit-wall/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#eef3ef',
    navigationBarTitleText: 'Between Us',
    navigationBarTextStyle: 'black',
    backgroundColor: '#eef3ef',
  },
  cloud: true,
})

function defineAppConfig<T>(config: T): T {
  return config
}
