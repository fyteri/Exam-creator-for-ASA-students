import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  FileText, 
  Upload, 
  CheckCircle2, 
  XCircle, 
  ChevronRight, 
  ChevronLeft, 
  RotateCcw,
  Trophy,
  Loader2,
  AlertCircle,
  RefreshCw
} from 'lucide-react';

// Инициализация PDF.js
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Интерфейсы
interface Question {
  id: number;
  text: string;
  options: string[];
  correctAnswer: string;
  explanation?: string;
}

interface AppState {
  step: 'upload' | 'parsing' | 'exam' | 'results';
  questions: Question[];
  currentQuestionIndex: number;
  userAnswers: Record<number, string>;
  isLoading: boolean;
  error: string | null;
}

// Вспомогательная функция для перемешивания массива
function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

const ExamApp = () => {
  const [state, setState] = useState<AppState>({
    step: 'upload',
    questions: [],
    currentQuestionIndex: 0,
    userAnswers: {},
    isLoading: false,
    error: null,
  });

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Извлечение текста из PDF
  const extractTextFromPDF = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += `--- Страница ${i} ---\n${pageText}\n\n`;
    }
    return fullText;
  };

  // Парсинг вопросов через Gemini
  const generateQuestions = async (text: string) => {
    setState(prev => ({ ...prev, step: 'parsing', isLoading: true, error: null }));
    
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Проанализируй следующий текст из PDF-файла и выдели ровно 25 вопросов для теста. 
        В тексте уже есть правильные ответы, найди их. Если вопросов меньше 25, возьми все, что есть.
        
        Текст: ${text.substring(0, 30000)}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    text: { type: Type.STRING, description: "Текст вопроса" },
                    options: { 
                      type: Type.ARRAY, 
                      items: { type: Type.STRING },
                      description: "4 варианта ответа"
                    },
                    correctAnswer: { type: Type.STRING, description: "Точный текст правильного ответа" },
                    explanation: { type: Type.STRING, description: "Краткое объяснение почему этот ответ верный" }
                  },
                  required: ["id", "text", "options", "correctAnswer"]
                }
              }
            }
          }
        }
      });

      const data = JSON.parse(response.text || '{"questions": []}');
      if (data.questions && data.questions.length > 0) {
        // Перемешиваем вопросы и варианты ответов внутри каждого вопроса
        const randomizedQuestions = shuffleArray(data.questions).map((q: Question) => ({
          ...q,
          options: shuffleArray(q.options)
        }));

        setState(prev => ({
          ...prev,
          step: 'exam',
          questions: randomizedQuestions,
          isLoading: false
        }));
      } else {
        throw new Error("Не удалось распознать вопросы в этом документе.");
      }
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        step: 'upload',
        isLoading: false,
        error: "Ошибка при анализе PDF: " + (err.message || "попробуйте другой файл")
      }));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setState(prev => ({ ...prev, error: "Пожалуйста, загрузите только PDF-файл." }));
      return;
    }

    try {
      const text = await extractTextFromPDF(file);
      await generateQuestions(text);
    } catch (err) {
      setState(prev => ({ ...prev, error: "Не удалось прочитать PDF файл." }));
    }
  };

  const selectAnswer = (answer: string) => {
    setState(prev => ({
      ...prev,
      userAnswers: { ...prev.userAnswers, [prev.currentQuestionIndex]: answer }
    }));
  };

  const nextQuestion = () => {
    if (state.currentQuestionIndex < state.questions.length - 1) {
      setState(prev => ({ ...prev, currentQuestionIndex: prev.currentQuestionIndex + 1 }));
    } else {
      setState(prev => ({ ...prev, step: 'results' }));
    }
  };

  const prevQuestion = () => {
    if (state.currentQuestionIndex > 0) {
      setState(prev => ({ ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 }));
    }
  };

  const restartFull = () => {
    setState({
      step: 'upload',
      questions: [],
      currentQuestionIndex: 0,
      userAnswers: {},
      isLoading: false,
      error: null,
    });
  };

  const retakeCurrent = () => {
    // Перемешиваем текущие вопросы заново для новой попытки
    const reshuffledQuestions = shuffleArray(state.questions).map(q => ({
      ...q,
      options: shuffleArray(q.options)
    }));

    setState(prev => ({
      ...prev,
      step: 'exam',
      questions: reshuffledQuestions,
      currentQuestionIndex: 0,
      userAnswers: {},
      error: null
    }));
  };

  // Расчет результатов
  const calculateResults = () => {
    let correctCount = 0;
    state.questions.forEach((q, idx) => {
      if (state.userAnswers[idx] === q.correctAnswer) {
        correctCount++;
      }
    });
    return {
      correct: correctCount,
      total: state.questions.length,
      score: correctCount * 2
    };
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-slate-900 mb-2 flex items-center justify-center gap-3">
          <FileText className="text-blue-600 w-10 h-10" />
          Экзамен-Мастер 
        </h1>
        <p className="text-slate-500">Загрузите PDF с ответами и проверьте свои знания</p>
      </div>

      {state.error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700 animate-in fade-in duration-300">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{state.error}</p>
        </div>
      )}

      {/* Upload Step */}
      {state.step === 'upload' && (
        <div className="glass-card rounded-3xl p-12 text-center border-2 border-dashed border-slate-200 hover:border-blue-400 transition-all cursor-pointer group relative">
          <input 
            type="file" 
            accept=".pdf" 
            onChange={handleFileUpload}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Upload className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-semibold text-slate-800 mb-2">Загрузите ваш документ</h2>
            <p className="text-slate-500 max-w-sm mx-auto">
              Мы просканируем PDF, найдем вопросы и подготовим для вас персональный экзамен. Порядок вопросов всегда будет случайным!
            </p>
            <div className="mt-8 px-6 py-2 bg-blue-600 text-white rounded-full font-medium shadow-lg shadow-blue-200">
              Выбрать PDF файл
            </div>
          </div>
        </div>
      )}

      {/* Parsing Step */}
      {state.step === 'parsing' && (
        <div className="glass-card rounded-3xl p-16 text-center shadow-xl">
          <div className="flex flex-col items-center">
            <div className="relative mb-8">
              <Loader2 className="w-20 h-20 text-blue-600 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <FileText className="w-8 h-8 text-blue-400" />
              </div>
            </div>
            <h2 className="text-2xl font-semibold text-slate-800 mb-2">Анализируем и перемешиваем...</h2>
            <p className="text-slate-500 animate-pulse">
              Gemini AI извлекает вопросы, а мы создаем для вас уникальную версию теста.
            </p>
            <div className="w-full max-w-md bg-slate-100 h-2 rounded-full mt-8 overflow-hidden">
              <div className="bg-blue-600 h-full animate-progress-indeterminate w-1/3 rounded-full"></div>
            </div>
          </div>
        </div>
      )}

      {/* Exam Step */}
      {state.step === 'exam' && state.questions.length > 0 && (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
          <div className="flex justify-between items-center px-2">
            <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
              Вопрос {state.currentQuestionIndex + 1} из {state.questions.length}
            </span>
            <div className="flex gap-1">
              {state.questions.map((_, i) => (
                <div 
                  key={i} 
                  className={`h-1.5 w-6 rounded-full transition-all ${
                    i === state.currentQuestionIndex ? 'bg-blue-600 w-10' : 
                    state.userAnswers[i] ? 'bg-green-400' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="glass-card rounded-3xl p-8 md:p-10 shadow-xl border border-white">
            <h3 className="text-2xl font-medium text-slate-800 mb-8 leading-relaxed">
              {state.questions[state.currentQuestionIndex].text}
            </h3>

            <div className="space-y-4">
              {state.questions[state.currentQuestionIndex].options.map((option, idx) => {
                const isSelected = state.userAnswers[state.currentQuestionIndex] === option;
                return (
                  <button
                    key={idx}
                    onClick={() => selectAnswer(option)}
                    className={`w-full text-left p-5 rounded-2xl border-2 transition-all flex items-center justify-between group ${
                      isSelected 
                        ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-md' 
                        : 'border-slate-100 hover:border-blue-200 hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <span className="text-lg font-medium">{option}</span>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300'
                    }`}>
                      {isSelected && <div className="w-2.5 h-2.5 bg-white rounded-full" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between items-center pt-4">
            <button
              onClick={prevQuestion}
              disabled={state.currentQuestionIndex === 0}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-slate-600 hover:bg-white disabled:opacity-0 transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
              Назад
            </button>
            <button
              onClick={nextQuestion}
              disabled={!state.userAnswers[state.currentQuestionIndex]}
              className="flex items-center gap-2 px-8 py-4 bg-blue-600 text-white rounded-2xl font-semibold shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95"
            >
              {state.currentQuestionIndex === state.questions.length - 1 ? 'Завершить тест' : 'Следующий вопрос'}
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Results Step */}
      {state.step === 'results' && (() => {
        const results = calculateResults();
        const percentage = Math.round((results.correct / results.total) * 100);
        
        return (
          <div className="animate-in zoom-in-95 duration-500">
            <div className="glass-card rounded-3xl p-12 text-center shadow-2xl mb-8 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-blue-600" />
              <div className="w-24 h-24 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trophy className="w-12 h-12" />
              </div>
              <h2 className="text-3xl font-bold text-slate-800 mb-2">Ваш результат</h2>
              <p className="text-slate-500 mb-8">Тестирование успешно завершено</p>

              <div className="grid grid-cols-2 gap-6 mb-10">
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <div className="text-4xl font-black text-blue-600 mb-1">{results.score}</div>
                  <div className="text-sm font-semibold text-slate-400 uppercase tracking-tighter">Всего баллов</div>
                </div>
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <div className="text-4xl font-black text-green-500 mb-1">{results.correct}/{results.total}</div>
                  <div className="text-sm font-semibold text-slate-400 uppercase tracking-tighter">Правильных ответов</div>
                </div>
              </div>

              <div className="w-full bg-slate-100 h-4 rounded-full mb-4 overflow-hidden">
                <div 
                  className={`h-full transition-all duration-1000 ease-out ${percentage > 50 ? 'bg-green-500' : 'bg-orange-500'}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <p className="text-lg font-semibold text-slate-700 mb-10">{percentage}% успеха</p>
              
              <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
                <button
                  onClick={retakeCurrent}
                  className="flex items-center justify-center gap-2 w-full max-w-xs px-8 py-4 bg-blue-600 text-white rounded-2xl font-semibold shadow-xl hover:bg-blue-700 transition-all active:scale-95"
                >
                  <RefreshCw className="w-5 h-5" />
                  Пересдать (рандомно)
                </button>
                <button
                  onClick={restartFull}
                  className="flex items-center justify-center gap-2 w-full max-w-xs px-8 py-4 bg-slate-900 text-white rounded-2xl font-semibold shadow-xl hover:bg-black transition-all active:scale-95"
                >
                  <RotateCcw className="w-5 h-5" />
                  Новый файл
                </button>
              </div>
            </div>

            {/* Detailed Breakdown */}
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-slate-800 px-2">Детальный разбор</h3>
              {state.questions.map((q, idx) => {
                const userAns = state.userAnswers[idx];
                const isCorrect = userAns === q.correctAnswer;
                
                return (
                  <div key={idx} className={`glass-card rounded-2xl p-6 border-l-8 ${isCorrect ? 'border-l-green-500' : 'border-l-red-500'}`}>
                    <div className="flex items-start gap-4">
                      <div className={`mt-1 flex-shrink-0 ${isCorrect ? 'text-green-500' : 'text-red-500'}`}>
                        {isCorrect ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-slate-800 mb-3">{q.text}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div className={`p-3 rounded-xl border ${isCorrect ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                            <span className="block text-xs font-bold uppercase mb-1 opacity-60">Ваш ответ</span>
                            {userAns || "Не отвечено"}
                          </div>
                          {!isCorrect && (
                            <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
                              <span className="block text-xs font-bold uppercase mb-1 opacity-60">Правильный ответ</span>
                              {q.correctAnswer}
                            </div>
                          )}
                        </div>
                        {q.explanation && (
                          <p className="mt-4 text-sm text-slate-500 italic bg-slate-50 p-3 rounded-lg border border-slate-100">
                            💡 {q.explanation}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`text-lg font-bold ${isCorrect ? 'text-green-600' : 'text-red-400'}`}>
                          {isCorrect ? '+2' : '0'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      
      {/* Footer info */}
      <div className="mt-16 text-center text-slate-400 text-sm">
        <p>© 2026 Exam Master • Сделано для студентов ASA</p>
      </div>

      <style>{`
        @keyframes progress-indeterminate {
          0% { transform: translateX(-100%); width: 30%; }
          50% { width: 60%; }
          100% { transform: translateX(400%); width: 30%; }
        }
        .animate-progress-indeterminate {
          animation: progress-indeterminate 2s infinite linear;
        }
      `}</style>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<ExamApp />);
}