import * as React from 'react'
import { Dispatch } from 'raj-ts'
import { withSubscriptions } from 'raj-ts/lib/subscription'

type Shape = {
  points: Point[]
}

type Size = {
  width: number
  height: number
}

type Model = {
  page: 'home' | 'game' | 'game-over'
  homeColor: string
  shape: Shape
  windowSize: Size
  canvasSize: Size
  canvasViewSize: Size
  shapeDrawAreaSize: Size
  foregroundCanvasElement: HTMLCanvasElement | undefined
  backgroundCanvasElement: HTMLCanvasElement | undefined
  offscreenCanvasElement: HTMLCanvasElement
  foregroundCtx: CanvasRenderingContext2D | undefined
  backgroundCtx: CanvasRenderingContext2D | undefined
  gameStart: number
  gameLength: number

  drawPointBuffer: Point[]
  lastDrawnAt: number

  pixelsFilled: number
  pixelsOverfilled: number
  pixelsUnderFilled: number

  finalUrl: string | undefined
  scoreExplainerOpen: boolean
}

type Msg =
  | { type: 'start_game' }
  | { type: 'end_game' }
  | {
      type: 'canvas_mounted'
      kind: 'foreground' | 'background'
      canvasElement: HTMLCanvasElement
    }
  | { type: 'canvas_render' }
  | { type: 'canvas_draw'; windowX: number; windowY: number }
  | { type: 'canvas_draw_end' }
  | { type: 'window_resize'; width: number; height: number }
  | { type: 'home_carousel_tick' }
  | { type: 'game_tick' }
  | { type: 'open_score_explainer' }
  | { type: 'dismiss_score_explainer' }

function makeRandomPoint(viewPort: Size): Point {
  return {
    x: Math.floor(Math.random() * (viewPort.width - 20)) + 10,
    y: Math.floor(Math.random() * (viewPort.height - 20)) + 10,
  }
}

type Point = { x: number; y: number }

function pointComparator(a: Point, b: Point): number {
  if (a.x < b.x) {
    return -1
  }

  if (a.x > b.x) {
    return +1
  }

  if (a.y < b.y) {
    return -1
  }

  if (a.y > b.y) {
    return +1
  }

  return 0
}

// Modernized from https://www.nayuki.io/res/convex-hull-algorithm/convex-hull.ts
function makeHullPresorted(points: Readonly<Array<Point>>): Array<Point> {
  if (points.length <= 1) return points.slice()

  // Andrew's monotone chain algorithm. Positive y coordinates correspond to "up"
  // as per the mathematical convention, instead of "down" as per the computer
  // graphics convention. This doesn't affect the correctness of the result.

  let upperHull: Array<Point> = []
  for (let i = 0; i < points.length; i++) {
    const p: Point = points[i]
    while (upperHull.length >= 2) {
      const q: Point = upperHull[upperHull.length - 1]
      const r: Point = upperHull[upperHull.length - 2]
      if ((q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x))
        upperHull.pop()
      else break
    }
    upperHull.push(p)
  }
  upperHull.pop()

  let lowerHull: Array<Point> = []
  for (let i = points.length - 1; i >= 0; i--) {
    const p: Point = points[i]
    while (lowerHull.length >= 2) {
      const q: Point = lowerHull[lowerHull.length - 1]
      const r: Point = lowerHull[lowerHull.length - 2]
      if ((q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x))
        lowerHull.pop()
      else break
    }
    lowerHull.push(p)
  }
  lowerHull.pop()

  if (
    upperHull.length === 1 &&
    lowerHull.length === 1 &&
    upperHull[0].x === lowerHull[0].x &&
    upperHull[0].y === lowerHull[0].y
  )
    return upperHull
  else return upperHull.concat(lowerHull)
}

function makeLines(points: Point[]): [Point, Point][] {
  const lines: [Point, Point][] = []

  const [start, ...rest] = points

  for (let i = 0; i < points.length; i++) {
    lines.push([points[i], rest[i]])
  }

  lines[points.length - 1][1] = start
  return lines
}

function makeRandomShape(viewPort: Size): Shape {
  const randomPoints = []
  const count = 10 + Math.floor(Math.random() * 6)
  for (let i = 0; i < count; i++) {
    randomPoints.push(makeRandomPoint(viewPort))
  }

  const hull = makeHullPresorted(randomPoints.sort(pointComparator))

  const innerView = { width: viewPort.width / 4, height: viewPort.height / 4 }
  const [top, bottom] = [makeRandomPoint(innerView), makeRandomPoint(innerView)]
    .map((p, i) => ({
      x: p.x + innerView.width * (i === 0 ? 0.75 : 1.25),
      y: p.y + innerView.height * (i === 0 ? 0.75 : 1.25),
    }))
    .sort(pointComparator)

  const a = Math.floor(Math.random() * (hull.length / 2))
  const b = Math.floor(Math.random() * (hull.length / 2) + hull.length / 2)

  hull.splice(a, 0, top)
  hull.splice(b, 0, bottom)
  const points = hull

  const lines = makeLines(points)

  if (
    lines.some((line) =>
      lines.some((l) =>
        intersects(
          line[0].x,
          line[0].y,
          line[1].x,
          line[1].y,
          l[0].x,
          l[0].y,
          l[1].x,
          l[1].y
        )
      )
    )
  ) {
    return makeRandomShape(viewPort)
  }

  const range = Math.min(viewPort.width, viewPort.height) / 10
  if (points.some((a) => points.some((b) => a !== b && nearBy(a, b, range)))) {
    return makeRandomShape(viewPort)
  }

  return { points }
}

function nearBy(a: Point, b: Point, range: number) {
  const distX = Math.abs(b.x - a.x)
  const distY = Math.abs(b.y - a.y)
  return distY < range && distX < range
}

// Gleaned from https://stackoverflow.com/a/24392281
function intersects(
  a: number,
  b: number,
  c: number,
  d: number,
  p: number,
  q: number,
  r: number,
  s: number
) {
  var det, gamma, lambda
  det = (c - a) * (s - q) - (r - p) * (d - b)
  if (det === 0) {
    return false
  } else {
    lambda = ((s - q) * (r - a) + (p - r) * (s - b)) / det
    gamma = ((b - d) * (r - a) + (c - a) * (s - b)) / det
    return 0 < lambda && lambda < 1 && 0 < gamma && gamma < 1
  }
}

const randomBetween = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1))

function makeRandomColor() {
  const r = randomBetween(0, 255)
  const g = randomBetween(0, 255)
  const b = randomBetween(0, 255)
  return `rgb(${r},${g},${b})`
}

function getLineWidthForCanvasSize(canvasViewSize: Size): number {
  const min = Math.min(canvasViewSize.width, canvasViewSize.height)
  if (min > 1000) {
    return 20
  }

  if (min > 500) {
    return 15
  }

  return 10
}

function drawShapeToCanvas(
  ctx: CanvasRenderingContext2D,
  canvasViewSize: Size,
  shape: Shape,
  color: string,
  fill: boolean,
  clear: boolean
) {
  if (clear) {
    ctx.clearRect(0, 0, canvasViewSize.width, canvasViewSize.height)
  }
  const [start, ...rest] = shape.points
  const points = [start, ...rest, start]

  ctx.lineWidth = getLineWidthForCanvasSize(canvasViewSize)
  ctx.lineCap = 'round'
  ctx.strokeStyle = color
  ctx.fillStyle = color

  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  for (let i = 0; i < points.length; i++) {
    const nextPoint = points[i + 1] || start

    var xc = (points[i].x + nextPoint.x) / 2
    var yc = (points[i].y + nextPoint.y) / 2
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc)
  }
  ctx.stroke()
  if (fill) {
    ctx.fill()
  }
}

function drawPoints(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.fillStyle = '#aaa'
  ctx.strokeStyle = '#aaa'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (points.length < 3) {
    var b = points[0]
    ctx.beginPath()
    ctx.arc(b.x, b.y, ctx.lineWidth / 2, 0, Math.PI * 2, !0)
    ctx.closePath()
    ctx.fill()
    return
  }

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)

  let i = 1
  for (; i < points.length - 2; i++) {
    const c = (points[i].x + points[i + 1].x) / 2
    const d = (points[i].y + points[i + 1].y) / 2
    ctx.quadraticCurveTo(points[i].x, points[i].y, c, d)
  }

  ctx.quadraticCurveTo(
    points[i].x,
    points[i].y,
    points[i + 1].x,
    points[i + 1].y
  )
  ctx.stroke()
}

const bufferTime = 2 * 1000

export const appProgram = withSubscriptions<Msg, Model, React.ReactNode>({
  init: [
    {
      page: 'home',
      homeColor: '#000',
      shape: { points: [] },
      windowSize: { width: 0, height: 0 },
      canvasSize: { width: 0, height: 0 },
      canvasViewSize: { width: 0, height: 0 },
      shapeDrawAreaSize: { width: 0, height: 0 },
      foregroundCanvasElement: undefined,
      backgroundCanvasElement: undefined,
      offscreenCanvasElement: document.createElement('canvas'),
      foregroundCtx: undefined,
      backgroundCtx: undefined,
      gameStart: 0,
      gameLength: 0,
      pixelsFilled: 0,
      pixelsOverfilled: 0,
      pixelsUnderFilled: 0,
      finalUrl: undefined,
      drawPointBuffer: [],
      lastDrawnAt: 0,
      scoreExplainerOpen: false,
    },
  ],
  update(msg, model) {
    switch (msg.type) {
      case 'start_game': {
        const newModel: Model = {
          ...model,
          page: 'game',
          gameStart: Date.now(),
          homeColor: '#000',
          shape: makeRandomShape(model.shapeDrawAreaSize),
          finalUrl: undefined,
        }

        return [
          newModel,
          () => {
            const { backgroundCtx, canvasViewSize } = model
            if (backgroundCtx && canvasViewSize) {
              backgroundCtx.clearRect(
                0,
                0,
                canvasViewSize.width,
                canvasViewSize.height
              )
            }

            drawShapeToCanvas(
              newModel.foregroundCtx!,
              newModel.canvasViewSize!,
              newModel.shape,
              newModel.homeColor,
              false,
              true
            )
          },
        ]
      }
      case 'end_game': {
        const gameLength = Date.now() - model.gameStart

        const {
          offscreenCanvasElement,
          backgroundCanvasElement,
          backgroundCtx,
          foregroundCanvasElement,
        } = model
        offscreenCanvasElement.width = backgroundCanvasElement!.width
        offscreenCanvasElement.height = backgroundCanvasElement!.height

        const offscreenCtx = offscreenCanvasElement.getContext('2d')!
        offscreenCtx.clearRect(
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height
        )
        offscreenCtx.drawImage(
          backgroundCanvasElement!,
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height,
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height
        )
        drawShapeToCanvas(
          offscreenCtx,
          model.canvasViewSize,
          model.shape,
          '#000',
          true,
          false
        )

        const pixels = offscreenCtx.getImageData(
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height
        ).data

        const gray = 170
        let pixelsOverfilled = 0
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] === gray) {
            pixelsOverfilled++
          }
        }

        offscreenCtx.clearRect(
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height
        )

        drawShapeToCanvas(
          offscreenCtx,
          model.canvasViewSize,
          model.shape,
          '#fff',
          true,
          false
        )

        const drawData = backgroundCtx!.getImageData(
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height
        ).data

        const fillData = offscreenCtx.getImageData(
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height
        ).data

        let pixelsFilled = 0
        let pixelsUnderFilled = 0
        for (let i = 0; i < fillData.length; i += 4) {
          if (fillData[i] !== 255) {
            continue
          }

          if (drawData[i] === gray) {
            pixelsFilled++
          } else {
            pixelsUnderFilled++
          }
        }

        offscreenCtx.fillStyle = '#fff'
        offscreenCtx.fillRect(
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height
        )

        offscreenCtx.drawImage(
          backgroundCanvasElement!,
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height,
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height
        )
        offscreenCtx.drawImage(
          foregroundCanvasElement!,
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height,
          0,
          0,
          model.canvasViewSize.width,
          model.canvasViewSize.height
        )

        // draw game name and score on image
        {
          const nameText = 'Color Blind'
          const padding = 10 * window.devicePixelRatio
          const score =
            (100 * pixelsFilled - pixelsOverfilled) /
            (pixelsFilled + pixelsUnderFilled)
          const seconds = Math.floor(gameLength / 1000)
          const scoreText = `Colored ${score.toFixed(2)}% in ${seconds} seconds`

          offscreenCtx.fillStyle = '#000'
          offscreenCtx.font =
            "bold 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"
          const nameSize = offscreenCtx.measureText(nameText)
          offscreenCtx.fillText(
            nameText,
            padding,
            model.canvasViewSize.height -
              padding -
              nameSize.fontBoundingBoxDescent * window.devicePixelRatio
          )

          const scoreSize = offscreenCtx.measureText(scoreText)
          offscreenCtx.fillText(
            scoreText,
            model.canvasViewSize.width - padding - scoreSize.width,
            model.canvasViewSize.height -
              padding -
              scoreSize.fontBoundingBoxDescent * window.devicePixelRatio
          )
        }

        const finalUrl = offscreenCanvasElement.toDataURL()

        return [
          {
            ...model,
            page: 'game-over',
            finalUrl,
            gameLength,
            pixelsFilled,
            pixelsOverfilled,
            pixelsUnderFilled,
          },
        ]
      }
      case 'open_score_explainer': {
        return [{ ...model, scoreExplainerOpen: model.page === 'game-over' }]
      }
      case 'dismiss_score_explainer': {
        return [{ ...model, scoreExplainerOpen: false }]
      }
      case 'window_resize': {
        if (model.page === 'game') {
          // Changing the size of the canvas causes it to be cleared.
          // We don't want to lose the drawing while in the game due to that.
          // So for lack of a workaround we just skip resizing during the game.
          return [model]
        }

        const { width, height } = msg
        const windowSize = { width, height }

        const framePadding = 20
        const reservedBottom = 70
        const frameWidth = width - framePadding * 2
        const frameHeight = height - framePadding * 2 - reservedBottom

        const widthLarger = width > height

        const canvasSize = widthLarger
          ? {
              width: frameWidth,
              height: Math.min(frameHeight, Math.floor(frameWidth / 1.5)),
            }
          : {
              height: frameHeight,
              width: Math.min(frameWidth, Math.floor(frameHeight / 1.5)),
            }

        const canvasViewSize = {
          width: canvasSize.width * window.devicePixelRatio,
          height: canvasSize.height * window.devicePixelRatio,
        }

        const shapeDrawAreaSize = {
          width: canvasViewSize.width,
          // We always leave room for the final image attribution
          // so the text doesn't overlap with the shape.
          height: canvasViewSize.height - 60,
        }

        const shape = model.shape.points.length
          ? model.shape
          : makeRandomShape(shapeDrawAreaSize)

        const newModel: Model = {
          ...model,
          shape,
          windowSize,
          canvasSize,
          canvasViewSize,
          shapeDrawAreaSize,
        }

        return [newModel]
      }
      case 'canvas_mounted': {
        const { canvasElement } = msg
        const ctx = canvasElement.getContext('2d')!

        let updates: Partial<Model>
        switch (msg.kind) {
          case 'foreground':
            updates = {
              foregroundCanvasElement: canvasElement,
              foregroundCtx: ctx,
            }
            break
          case 'background':
            updates = {
              backgroundCanvasElement: canvasElement,
              backgroundCtx: ctx,
            }
            break
        }

        return [
          {
            ...model,
            ...updates,
          },
        ]
      }

      case 'canvas_render': {
        const { foregroundCtx } = model
        if (!foregroundCtx) {
          return [model]
        }

        return [model]
      }

      case 'canvas_draw': {
        const rect = model.backgroundCanvasElement!.getBoundingClientRect()
        const x = (msg.windowX - rect.left) * window.devicePixelRatio
        const y = (msg.windowY - rect.top) * window.devicePixelRatio
        const newPoint = { x, y }

        const { drawPointBuffer } = model
        if (drawPointBuffer.length < 5) {
          drawPointBuffer.push(newPoint)
          return [model]
        }

        const { backgroundCtx } = model
        if (!backgroundCtx) {
          return [model]
        }

        return [
          { ...model, drawPointBuffer: [newPoint] },
          () => {
            backgroundCtx.lineWidth =
              2 * getLineWidthForCanvasSize(model.canvasViewSize)

            drawPoints(backgroundCtx, drawPointBuffer.concat(newPoint))
          },
        ]
      }

      case 'canvas_draw_end': {
        const { drawPointBuffer } = model
        if (!drawPointBuffer.length) {
          return [model]
        }

        const { backgroundCtx } = model
        if (!backgroundCtx) {
          return [model]
        }

        return [
          { ...model, drawPointBuffer: [] },
          () => {
            backgroundCtx.lineWidth =
              2 * getLineWidthForCanvasSize(model.canvasViewSize)

            drawPoints(backgroundCtx, drawPointBuffer)
          },
        ]
      }

      case 'home_carousel_tick': {
        const color = makeRandomColor()
        const newModel = {
          ...model,
          homeColor: color,
          shape: makeRandomShape(model.shapeDrawAreaSize),
        }

        const { foregroundCtx, canvasViewSize } = model
        if (!foregroundCtx) {
          return [newModel]
        }

        return [
          newModel,
          () =>
            drawShapeToCanvas(
              foregroundCtx,
              canvasViewSize,
              model.shape,
              model.homeColor,
              false,
              true
            ),
        ]
      }
      case 'game_tick': {
        return [model]
      }
    }
  },
  subscriptions(model) {
    return {
      windowSize() {
        let _dispatch: Dispatch<Msg>
        function onResize() {
          _dispatch({
            type: 'window_resize',
            width: window.innerWidth,
            height: window.innerHeight,
          })
        }

        return {
          effect(dispatch) {
            _dispatch = dispatch
            window.addEventListener('resize', onResize)
            onResize()
          },
          cancel() {
            window.removeEventListener('resize', onResize)
          },
        }
      },
      homeCarousel:
        model.page === 'home'
          ? () => {
              let timerId: any

              return {
                effect(dispatch) {
                  timerId = setInterval(
                    () => dispatch({ type: 'home_carousel_tick' }),
                    250
                  )
                },
                cancel() {
                  clearInterval(timerId)
                },
              }
            }
          : undefined,
      gameTick:
        model.page === 'game'
          ? () => {
              let timerId: any

              return {
                effect(dispatch) {
                  timerId = setInterval(
                    () => dispatch({ type: 'game_tick' }),
                    100
                  )
                },
                cancel() {
                  clearInterval(timerId)
                },
              }
            }
          : undefined,
    } as const
  },
  view(model, dispatch) {
    ;(window as any).$model = model

    let action
    switch (model.page) {
      case 'home':
        action = (
          <button
            className="nav-button"
            onClick={() => dispatch({ type: 'start_game' })}
          >
            Start
          </button>
        )
        break
      case 'game':
        action = (
          <button
            className="nav-button"
            onClick={() => dispatch({ type: 'end_game' })}
          >
            Finish
          </button>
        )
        break
      case 'game-over':
        action = (
          <button
            className="nav-button"
            onClick={() => dispatch({ type: 'start_game' })}
          >
            Play again
          </button>
        )
        break
    }

    const now = Date.now()
    const timeSinceStart = now - model.gameStart
    const opacity =
      model.page === 'game'
        ? Math.max(0, (bufferTime - timeSinceStart) / bufferTime)
        : 1

    const baseCanvasStyle = {
      width: model.canvasSize.width,
      height: model.canvasSize.height,
    }

    const baseCanvasProps = {
      width: model.canvasViewSize.width,
      height: model.canvasViewSize.height,
    }

    const foregroundCanvasProps = {
      ...baseCanvasProps,
      style: {
        ...baseCanvasStyle,
      },
    }

    const backgroundCanvasProps = {
      ...baseCanvasProps,
      style: {
        ...baseCanvasStyle,
      },
    }

    const drawEnd = () => dispatch({ type: 'canvas_draw_end' })

    return (
      <div className="app">
        <div className="container">
          <div
            className="frame"
            style={{
              opacity,
              cursor: model.page === 'game' ? 'crosshair' : undefined,
            }}
            onTouchMove={
              model.page === 'game'
                ? (e) => {
                    dispatch({
                      type: 'canvas_draw',
                      windowX: e.touches[0].clientX,
                      windowY: e.touches[0].clientY,
                    })
                  }
                : undefined
            }
            {...{
              onTouchEnd: drawEnd,
              onMouseMove:
                model.page === 'game'
                  ? (e) => {
                      if (e.buttons === 1) {
                        dispatch({
                          type: 'canvas_draw',
                          windowX: e.clientX,
                          windowY: e.clientY,
                        })
                      }
                    }
                  : undefined,
              onMouseUp: drawEnd,
              onMouseLeave: drawEnd,
            }}
          >
            <canvas
              id="background"
              key="background"
              {...backgroundCanvasProps}
              ref={
                model.backgroundCanvasElement
                  ? undefined
                  : (el) => {
                      if (el) {
                        dispatch({
                          type: 'canvas_mounted',
                          kind: 'background',
                          canvasElement: el!,
                        })
                      }
                    }
              }
            />
            <canvas
              id="foreground"
              key="foreground"
              {...foregroundCanvasProps}
              ref={
                model.foregroundCanvasElement
                  ? undefined
                  : (el) => {
                      if (el) {
                        dispatch({
                          type: 'canvas_mounted',
                          kind: 'foreground',
                          canvasElement: el!,
                        })
                      }
                    }
              }
            >
              Your browser doesn't support the canvas API, which this game
              requires.
            </canvas>

            {model.finalUrl && (
              <div>
                <img
                  alt="Your drawing, maybe save it!"
                  className="picture"
                  src={model.finalUrl}
                />
              </div>
            )}

            {model.page === 'game-over' && (
              <div className="score">
                <div className="score-inner">
                  <div className="stat">
                    <label>Colored</label>
                    <b>
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          dispatch({ type: 'open_score_explainer' })
                        }}
                      >
                        {(
                          (100 * model.pixelsFilled - model.pixelsOverfilled) /
                          (model.pixelsFilled + model.pixelsUnderFilled)
                        ).toFixed(2) + '%'}
                      </button>
                    </b>
                  </div>

                  <div className="stat">
                    <label>Seconds</label>
                    <b>{Math.floor(model.gameLength / 1000)}</b>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="nav">
            <p className="credit">
              <b>Color Blind</b>
              <br /> by <a href="https://jew.ski/">Chris Andrejewski</a>
            </p>

            {action}
          </div>

          {model.scoreExplainerOpen && (
            <div className="modal-container">
              <div className="modal">
                <h3>Scoring</h3>
                <p>
                  The "Colored" percentage is{' '}
                  <b>pixels colored inside the lines</b> minus{' '}
                  <b>pixels colored outside the lines</b> divided by the{' '}
                  <b>shape area in pixels</b> that could have been colored.
                </p>
                <table className="stats">
                  <tbody>
                    <tr>
                      <th>Pixels colored inside the lines</th>
                      <td>{model.pixelsFilled} </td>
                    </tr>
                    <tr>
                      <th>Pixels colored outside the lines</th>
                      <td>{model.pixelsOverfilled}</td>
                    </tr>
                    <tr>
                      <th>Pixels missed colored</th>
                      <td>{model.pixelsUnderFilled}</td>
                    </tr>
                    <tr>
                      <th>Shape area in pixels</th>
                      <td>{model.pixelsFilled + model.pixelsUnderFilled}</td>
                    </tr>
                  </tbody>
                </table>

                <button
                  className="nav-button"
                  onClick={() => dispatch({ type: 'dismiss_score_explainer' })}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  },
})
