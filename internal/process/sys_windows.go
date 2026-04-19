//go:build windows

package process

import (
	"os/exec"
	"sync"
	"syscall"
	"unsafe"
)

var (
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObject          = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
)

const (
	JobObjectExtendedLimitInformation = 9
	JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
	// CREATE_NO_WINDOW: 子进程为控制台程序时也不分配可见控制台，避免从 GUI 主程序弹出 cmd 黑窗。
	createNoWindow = 0x08000000
)

type JOBOBJECT_BASIC_LIMIT_INFORMATION struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type IO_COUNTERS struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type JOBOBJECT_EXTENDED_LIMIT_INFORMATION struct {
	BasicLimitInformation JOBOBJECT_BASIC_LIMIT_INFORMATION
	IoCounters            IO_COUNTERS
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

var globalJobHandle syscall.Handle

// InitJobObject 初始化并配置当前进程的 Job Object，确保程序退出时所有子进程一并关停
func InitJobObject() {
	handle, _, _ := procCreateJobObject.Call(0, 0)
	if handle == 0 {
		return
	}
	globalJobHandle = syscall.Handle(handle)

	info := JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

	_, _, _ = procSetInformationJobObject.Call(
		uintptr(globalJobHandle),
		uintptr(JobObjectExtendedLimitInformation),
		uintptr(unsafe.Pointer(&info)),
		uintptr(unsafe.Sizeof(info)),
	)
}

// PrepareSilentCommand ensures the console window is hidden on Windows and assigned to the Job Object
func PrepareSilentCommand(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow

	// 如果 Job Object 已初始化，则确保子进程在创建后立即关联 (Windows Go 1.7+ 支持在 Cmd 启动后通过 Job 管理)
	// 注意：在 Windows 上，AssignProcessToJobObject 通常在 Process 启动后调用。
	// 这里我们主要依靠 InitJobObject 将自身加入 Job，这样所有由自身 Spawn 的子进程默认都会继承 Job 关系。
	if globalJobHandle != 0 {
		// 将当前进程先加入 Job (如果是第一次调用)
		staticOnce.Do(func() {
			currentProcess, _ := syscall.GetCurrentProcess()
			_, _, _ = procAssignProcessToJobObject.Call(uintptr(globalJobHandle), uintptr(currentProcess))
		})
	}
}

var staticOnce sync.Once

// PrepareSilentRun 与 PrepareSilentCommand 等价；保留别名便于语义区分（Run/Start 路径）。
func PrepareSilentRun(cmd *exec.Cmd) {
	PrepareSilentCommand(cmd)
}

