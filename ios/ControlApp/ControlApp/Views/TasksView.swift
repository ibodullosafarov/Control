import SwiftUI
import SwiftData

struct TasksView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \TaskItem.order) private var tasks: [TaskItem]
    @Query private var modes: [StudyMode]
    
    @State private var showingAddTask = false
    @State private var newTaskTitle = ""
    
    var body: some View {
        NavigationStack {
            List {
                ForEach(tasks.filter { !$0.isCompleted }) { task in
                    TaskRowView(task: task)
                }
                
                if !tasks.filter({ $0.isCompleted }).isEmpty {
                    Section("Completed") {
                        ForEach(tasks.filter { $0.isCompleted }) { task in
                            TaskRowView(task: task)
                                .opacity(0.6)
                        }
                    }
                }
            }
            .navigationTitle("Tasks")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showingAddTask = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .alert("New Task", isPresented: $showingAddTask) {
                TextField("Task title", text: $newTaskTitle)
                Button("Cancel", role: .cancel) {
                    newTaskTitle = ""
                }
                Button("Add") {
                    addTask()
                }
            }
        }
    }
    
    private func addTask() {
        guard !newTaskTitle.isEmpty else { return }
        let task = TaskItem(title: newTaskTitle, order: tasks.count)
        modelContext.insert(task)
        try? modelContext.save()
        newTaskTitle = ""
    }
}

struct TaskRowView: View {
    @Environment(\.modelContext) private var modelContext
    @Bindable var task: TaskItem
    
    var body: some View {
        HStack {
            Button {
                task.isCompleted.toggle()
                if task.isCompleted {
                    task.completedAt = Date()
                } else {
                    task.completedAt = nil
                }
                try? modelContext.save()
            } label: {
                Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(task.isCompleted ? .green : .gray)
            }
            .buttonStyle(.plain)
            
            VStack(alignment: .leading) {
                Text(task.title)
                    .strikethrough(task.isCompleted)
                
                if let cycles = task.cycles, cycles > 1 {
                    Text("\(task.cyclesCompleted ?? 0)/\(cycles) cycles")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            Spacer()
        }
    }
}
