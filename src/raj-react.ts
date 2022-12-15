import React from 'react'
import { Dispatch, Disposer, Program, runtime } from 'raj-ts'

export function reactProgram<Props, Model>(
  createApp: (props: Props) => Program<unknown, Model, unknown>
) {
  return class RajProgram extends React.Component<Props, { state: Model }> {
    _view?: (model: Model, dispatch: Dispatch<unknown>) => any
    _dispatch?: Dispatch<unknown>
    _killProgram?: Disposer

    override componentDidMount() {
      const app = createApp(this.props)
      this._view = app.view
      this._killProgram = runtime({
        ...app,
        view: (state, dispatch) => {
          this._dispatch = dispatch
          this.setState(() => ({ state }))
        },
      })
    }

    override componentWillUnmount() {
      if (this._killProgram) {
        this._killProgram()
        this._killProgram = undefined
      }
    }

    override render() {
      if (!(this._view && this._dispatch)) {
        return null
      }

      return this._view(this.state.state, this._dispatch)
    }
  }
}
