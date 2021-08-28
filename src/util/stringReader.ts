export class StringReader {
  private readonly text: string
  public index: number = 0

  constructor(s: string) {
    this.text = s
  }

  peek() {
    return this.text.charAt(this.index)
  }

  skip(amount: number = 1): StringReader {
    this.index += amount
    return this
  }

  isEOF() {
    return this.index >= this.text.length
  }
}
