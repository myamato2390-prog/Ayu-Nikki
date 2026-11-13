// カードの保管場所（Firebase の Firestore）。短いリンクでカードを送るために使う。
// お豆日記と同じ保管場所を使う（作者の決定）。カードの中の app: 'ayu-nikki' で、お豆日記のカードと見分ける。
// ここの値は「どの保管場所か」を表す公開の名前で、秘密の鍵ではない（アプリに入れて配るもの）。
// 読み書きできる範囲は Firebase 側のルールでしぼってある（番号を知っている人だけ読める・置くだけ・項目は d と exp だけ・30日で消える）。
// 空のままなら、カードは保管せず、長いリンクで送る
export const SHARE = {
  projectId: 'omame-nikki',
  databaseId: 'omame-nikki', // Firestore のデータベースの名前（初期値の (default) ではない）
  apiKey: 'AIzaSyBhz07lEFkNbBH1xZbrmFgplur0B8jHfMI',
};
