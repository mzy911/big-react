import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';

// function App() {
//   const [num, update] = useState(100);
//   return (
//     <ul onClick={() => update(500)}>
//       {new Array(num).fill(0).map((_, i) => {
//         return <Child key={i}>{i}</Child>;
//       })}
//     </ul>
//   );
// }
//
// function Child({ children }) {
//   const now = performance.now();
//   while (performance.now() - now < 4) {}
//   return <li>{children}</li>;
// }
//
// const root = ReactDOM.createRoot(document.querySelector('#root'));
//
// root.render(<App />);

function App() {
  const [name, setName] = useState(1);
  const [age, setAge] = useState(1);
  return (
    <div>
      <button
        onClick={() => {
          setName(6);
          setAge(8);
          setAge(9);
        }}
      >
        点击
      </button>

      <div>
        <div>名称：{name}</div>
        <div>年龄：{age}</div>
      </div>
    </div>
  );
}
const root = ReactDOM.createRoot(document.querySelector('#root'));

root.render(<App />);
